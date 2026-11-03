// mucke-loopback: small Windows helper for the Mucke desktop app.
//
// Uses the regular WASAPI loopback APIs that Windows offers for this purpose (the same mechanism OBS uses
// for "application audio capture"). It records what an app plays to the speakers. It does not touch DRM.
//
//   mucke-loopback list                      -> JSON array of apps that currently have an audio session
//   mucke-loopback capture <pid> include     -> record only this process (and its child processes)
//   mucke-loopback capture <pid> exclude     -> record everything except this process tree
//   mucke-loopback mute <pid> <0|1>          -> mute/unmute the app in the Windows volume mixer
//
// capture writes raw interleaved float32 stereo PCM at 48 kHz to stdout until stdin is closed.
// Status and errors go to stderr as single JSON lines.
//
// Needs Windows 10 2004 (build 19041) or newer.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#if __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#else
// Older MinGW headers lack these definitions (they are in the Windows SDK since 10.0.20348).
typedef enum AUDIOCLIENT_ACTIVATION_TYPE {
  AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
  AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum PROCESS_LOOPBACK_MODE {
  PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
  PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
} PROCESS_LOOPBACK_MODE;
typedef struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
  DWORD TargetProcessId;
  PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct AUDIOCLIENT_ACTIVATION_PARAMS {
  AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
  union {
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
  };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif
#include <audiopolicy.h>
#include <mmdeviceapi.h>
#include <fcntl.h>
#include <io.h>
#include <psapi.h>

#include <cstdio>
#include <cstdlib>
#include <algorithm>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

static const int RATE = 48000;
static const int CHANNELS = 2;

static void status(const char* kind, const char* msg, HRESULT hr = S_OK) {
  fprintf(stderr, "{\"%s\":\"%s\",\"hr\":\"0x%08lx\"}\n", kind, msg, (unsigned long)hr);
  fflush(stderr);
}

static std::string jsonEscape(const std::wstring& w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
  std::string out;
  for (char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    if ((unsigned char)c < 0x20) continue;
    out += c;
  }
  return out;
}

static std::wstring processName(DWORD pid) {
  if (pid == 0) return L"Systemsounds";
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return L"";
  wchar_t path[MAX_PATH];
  DWORD len = MAX_PATH;
  std::wstring name;
  if (QueryFullProcessImageNameW(h, 0, path, &len)) {
    name.assign(path, len);
    size_t slash = name.find_last_of(L"\\/");
    if (slash != std::wstring::npos) name = name.substr(slash + 1);
  }
  CloseHandle(h);
  return name;
}

template <class F>
static HRESULT forEachSession(F fn) {
  IMMDeviceEnumerator* en = nullptr;
  IMMDevice* dev = nullptr;
  IAudioSessionManager2* mgr = nullptr;
  IAudioSessionEnumerator* sessions = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&en);
  if (SUCCEEDED(hr)) hr = en->GetDefaultAudioEndpoint(eRender, eConsole, &dev);
  if (SUCCEEDED(hr)) hr = dev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&mgr);
  if (SUCCEEDED(hr)) hr = mgr->GetSessionEnumerator(&sessions);
  int count = 0;
  if (SUCCEEDED(hr)) hr = sessions->GetCount(&count);
  for (int i = 0; SUCCEEDED(hr) && i < count; i++) {
    IAudioSessionControl* ctl = nullptr;
    IAudioSessionControl2* ctl2 = nullptr;
    if (SUCCEEDED(sessions->GetSession(i, &ctl)) && SUCCEEDED(ctl->QueryInterface(__uuidof(IAudioSessionControl2), (void**)&ctl2))) {
      fn(ctl2);
      ctl2->Release();
    }
    if (ctl) ctl->Release();
  }
  if (sessions) sessions->Release();
  if (mgr) mgr->Release();
  if (dev) dev->Release();
  if (en) en->Release();
  return hr;
}

static int cmdList() {
  std::vector<DWORD> seen;
  std::string out = "[";
  HRESULT hr = forEachSession([&](IAudioSessionControl2* s) {
    DWORD pid = 0;
    s->GetProcessId(&pid);
    for (DWORD p : seen)
      if (p == pid) return;
    seen.push_back(pid);
    AudioSessionState state = AudioSessionStateInactive;
    s->GetState(&state);
    bool muted = false;
    ISimpleAudioVolume* vol = nullptr;
    if (SUCCEEDED(s->QueryInterface(__uuidof(ISimpleAudioVolume), (void**)&vol))) {
      BOOL m = FALSE;
      vol->GetMute(&m);
      muted = m;
      vol->Release();
    }
    std::wstring name = processName(pid);
    if (name.empty()) return;
    char buf[64];
    snprintf(buf, sizeof buf, "%s{\"pid\":%lu,", out.size() > 1 ? "," : "", (unsigned long)pid);
    out += buf;
    out += "\"name\":\"" + jsonEscape(name) + "\",";
    out += std::string("\"active\":") + (state == AudioSessionStateActive ? "true" : "false") + ",";
    out += std::string("\"muted\":") + (muted ? "true" : "false") + "}";
  });
  out += "]";
  if (FAILED(hr)) {
    status("error", "Audio-Sitzungen konnten nicht gelesen werden", hr);
    return 1;
  }
  printf("%s\n", out.c_str());
  return 0;
}

static int cmdMute(DWORD pid, bool mute) {
  int hits = 0;
  forEachSession([&](IAudioSessionControl2* s) {
    DWORD p = 0;
    s->GetProcessId(&p);
    if (p != pid) return;
    ISimpleAudioVolume* vol = nullptr;
    if (SUCCEEDED(s->QueryInterface(__uuidof(ISimpleAudioVolume), (void**)&vol))) {
      if (SUCCEEDED(vol->SetMute(mute, nullptr))) hits++;
      vol->Release();
    }
  });
  printf("{\"ok\":%s}\n", hits ? "true" : "false");
  return hits ? 0 : 1;
}

// --- process loopback capture ------------------------------------------------

class ActivationHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  IAudioClient* client = nullptr;

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return 2; }
  STDMETHODIMP_(ULONG) Release() override { return 1; }

  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hrActivate = E_FAIL;
    IUnknown* unk = nullptr;
    result = op->GetActivateResult(&hrActivate, &unk);
    if (SUCCEEDED(result)) result = hrActivate;
    if (SUCCEEDED(result)) result = unk->QueryInterface(__uuidof(IAudioClient), (void**)&client);
    if (unk) unk->Release();
    SetEvent(done);
    return S_OK;
  }
};

static int cmdCapture(DWORD pid, bool include) {
  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      include ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT pv = {};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = (BYTE*)&params;

  ActivationHandler handler;
  IActivateAudioInterfaceAsyncOperation* op = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, &handler, &op);
  if (FAILED(hr)) {
    status("error", "Prozess-Loopback wird von diesem Windows nicht unterstuetzt (ab Windows 10 2004)", hr);
    return 1;
  }
  WaitForSingleObject(handler.done, INFINITE);
  if (op) op->Release();
  if (FAILED(handler.result)) {
    status("error", "Aufnahme der App konnte nicht gestartet werden", handler.result);
    return 1;
  }
  IAudioClient* client = handler.client;

  WAVEFORMATEX fmt = {};
  fmt.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  fmt.nChannels = CHANNELS;
  fmt.nSamplesPerSec = RATE;
  fmt.wBitsPerSample = 32;
  fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, 200000,
                          0, &fmt, nullptr);
  IAudioCaptureClient* cap = nullptr;
  if (SUCCEEDED(hr)) hr = client->SetEventHandle(ready);
  if (SUCCEEDED(hr)) hr = client->GetService(__uuidof(IAudioCaptureClient), (void**)&cap);
  if (SUCCEEDED(hr)) hr = client->Start();
  if (FAILED(hr)) {
    status("error", "Audio-Client konnte nicht initialisiert werden", hr);
    return 1;
  }
  status("status", "recording");

  _setmode(_fileno(stdout), _O_BINARY);
  // Closing stdin (or the parent process exiting) stops the capture.
  volatile bool stop = false;
  std::thread watcher([&] {
    char b;
    while (fread(&b, 1, 1, stdin) == 1) {
    }
    stop = true;
    SetEvent(ready);
  });

  std::vector<float> silence;
  LARGE_INTEGER freq, t0, now;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&t0);
  unsigned long long written = 0;
  // Windows may deliver no packets at all while the app is quiet. Fill such gaps with silence so
  // several captures (and the timeline) stay in sync with the wall clock.
  auto padTo = [&](unsigned long long target) {
    while (written < target && !stop) {
      size_t frames = (size_t)std::min<unsigned long long>(target - written, RATE / 10);
      silence.assign(frames * CHANNELS, 0.0f);
      if (fwrite(silence.data(), sizeof(float) * CHANNELS, frames, stdout) != frames) stop = true;
      written += frames;
    }
  };
  while (!stop) {
    if (WaitForSingleObject(ready, 25) != WAIT_OBJECT_0) {
      QueryPerformanceCounter(&now);
      unsigned long long expected = (unsigned long long)((now.QuadPart - t0.QuadPart) * (double)RATE / freq.QuadPart);
      if (expected > written + RATE / 10) {
        padTo(expected);
        fflush(stdout);
      }
      continue;
    }
    UINT32 packet = 0;
    while (SUCCEEDED(cap->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      size_t bytes = (size_t)frames * fmt.nBlockAlign;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        silence.assign((size_t)frames * CHANNELS, 0.0f);
        data = (BYTE*)silence.data();
      }
      if (fwrite(data, 1, bytes, stdout) != bytes) stop = true;
      written += frames;
      cap->ReleaseBuffer(frames);
    }
    fflush(stdout);
  }
  client->Stop();
  cap->Release();
  client->Release();
  watcher.detach();
  return 0;
}

int main(int argc, char** argv) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return 1;
  if (argc >= 2 && !strcmp(argv[1], "list")) return cmdList();
  if (argc >= 4 && !strcmp(argv[1], "capture")) return cmdCapture(strtoul(argv[2], nullptr, 10), strcmp(argv[3], "exclude") != 0);
  if (argc >= 4 && !strcmp(argv[1], "mute")) return cmdMute(strtoul(argv[2], nullptr, 10), argv[3][0] == '1');
  fprintf(stderr, "usage: mucke-loopback list | capture <pid> include|exclude | mute <pid> 0|1\n");
  return 2;
}
