import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Icon, type IconName } from "../components/Icons";
import {
  clearUsageData,
  copyText,
  getDeepSeekStatus,
  getSettings,
  openExternal,
  refreshDeepSeekBalance,
  retryDeepSeekKeychain,
  saveDeepSeekApiKey,
  saveSettings,
} from "../lib/api";
import { formatRelative } from "../lib/format";
import type { DeepSeekStatus, Settings, SettingsView } from "../lib/types";

export function SettingsPage({ onSaved }: { onSaved: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [deepseek, setDeepseek] = useState<DeepSeekStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [settingsView, status] = await Promise.all([
        getSettings(),
        getDeepSeekStatus(),
      ]);
      setView(settingsView);
      setForm(settingsView.settings);
      setDeepseek(status);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((current) =>
      current ? ({ ...current, [key]: value } as Settings) : current,
    );
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const next = await saveSettings(form);
      setView(next);
      setForm(next.settings);
      setNotice(
        next.restartRequired
          ? "Settings saved. Restart TokenFlow to apply the new proxy port or upstream URL."
          : "Settings saved.",
      );
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveKey() {
    setSavingKey(true);
    setError(null);
    setNotice(null);
    const trimmed = apiKey.trim();

    try {
      const next = await saveDeepSeekApiKey(
        trimmed.length > 0 ? trimmed : null,
      );
      setView(next);
      setApiKey("");
      setNotice(
        next.deepseekKeySource === "environment"
          ? "A key is active from DEEPSEEK_API_KEY. The environment value takes precedence over the OS keychain."
          : trimmed.length > 0
            ? "DeepSeek key saved to the OS keychain. Refreshing the account balance…"
            : "DeepSeek key removed from the OS keychain.",
      );
      setDeepseek(await getDeepSeekStatus());
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleRemoveKey() {
    setSavingKey(true);
    setError(null);
    setNotice(null);

    try {
      const next = await saveDeepSeekApiKey(null);
      setView(next);
      setNotice(
        next.hasDeepseekApiKey
          ? "The saved key was removed from the OS keychain, but DEEPSEEK_API_KEY is still active."
          : "DeepSeek key removed from the OS keychain.",
      );
      setDeepseek(await getDeepSeekStatus());
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleRetryKeychain() {
    setSavingKey(true);
    setError(null);
    setNotice(null);

    try {
      const next = await retryDeepSeekKeychain();
      setView(next);
      setNotice(
        next.deepseekKeyError
          ? "The OS keychain is still unavailable."
          : "OS keychain connected.",
      );
      if (next.hasDeepseekApiKey) {
        await refreshDeepSeekBalance();
      }
      setDeepseek(await getDeepSeekStatus());
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleRefreshStatus() {
    try {
      setDeepseek(await getDeepSeekStatus());
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleClear() {
    if (
      !window.confirm(
        "Delete all recorded Ollama usage and DeepSeek balance history? Settings and API keys are kept. This cannot be undone.",
      )
    ) {
      return;
    }

    setClearing(true);
    setError(null);
    setNotice(null);

    try {
      const result = await clearUsageData();
      setNotice(
        `Deleted ${result.ollamaLogs} usage rows and ${result.deepseekBalances} balance snapshots.`,
      );
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setClearing(false);
    }
  }

  async function handleCopy(id: string, value: string) {
    const copiedOk = await copyText(value);
    if (copiedOk) {
      setCopied(id);
      window.setTimeout(
        () => setCopied((current) => (current === id ? null : current)),
        1600,
      );
    } else {
      setError("Clipboard access is unavailable in this environment.");
    }
  }

  if (loading) {
    return <SettingsSkeleton />;
  }

  if (!form || !view) {
    return (
      <div className="card flex items-center justify-between gap-3 p-5">
        <p className="text-sm text-slate-400">
          {error ?? "Could not load settings."}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-secondary"
        >
          Retry
        </button>
      </div>
    );
  }

  const baseUrl = `http://127.0.0.1:${form.proxyPort}`;
  const snippets = [
    {
      id: "continue",
      title: "Continue",
      hint: "~/.continue/config.json",
      code: `{
  "models": [
    {
      "title": "Ollama via TokenFlow",
      "provider": "ollama",
      "model": "llama3.2",
      "apiBase": "${baseUrl}"
    }
  ]
}`,
    },
    {
      id: "cline",
      title: "Cursor / Cline / OpenAI compatible",
      hint: "Use the OpenAI Compatible provider",
      code: `Base URL: ${baseUrl}/v1
API Key: ollama
Model: llama3.2`,
    },
    {
      id: "curl",
      title: "cURL smoke test",
      hint: "Native Ollama API through the proxy",
      code: `curl ${baseUrl}/api/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "llama3.2",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'`,
    },
  ];

  const keySourceLabel =
    view.deepseekKeySource === "environment"
      ? "DEEPSEEK_API_KEY"
      : view.deepseekKeySource === "keychain"
        ? "OS keychain"
        : view.deepseekKeySource === "legacy"
          ? "SQLite (insecure)"
          : null;

  const keyStorageWarning =
    view.deepseekKeyError ??
    (view.deepseekKeySource === "legacy"
      ? "This key is still stored in plaintext in the local SQLite database. TokenFlow will move it to the OS keychain when the keychain becomes available."
      : null);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {notice ? (
        <div className="flex items-start gap-3 rounded-xl border border-teal-400/20 bg-teal-400/[0.06] px-4 py-3">
          <Icon
            name="check"
            className="mt-0.5 h-4 w-4 shrink-0 text-teal-300"
          />
          <p className="text-xs leading-relaxed text-teal-100/80">{notice}</p>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3">
          <Icon
            name="alert"
            className="mt-0.5 h-4 w-4 shrink-0 text-rose-300"
          />
          <p className="text-xs leading-relaxed text-rose-200/80">{error}</p>
        </div>
      ) : null}

      {view.restartRequired ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
          <Icon
            name="refresh"
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
          />
          <p className="text-xs leading-relaxed text-amber-100/75">
            The running proxy does not match these settings. Restart TokenFlow
            to apply proxy port or upstream URL changes.
          </p>
        </div>
      ) : null}

      <form onSubmit={handleSave} className="space-y-4">
        <Section
          title="Ollama proxy"
          description="A loopback drop-in replacement for Ollama. Requests are forwarded unchanged; token counts are captured from the response."
          icon="database"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Ollama upstream URL</span>
              <input
                className="input mt-2"
                value={form.upstreamUrl}
                onChange={(event) => patch("upstreamUrl", event.target.value)}
                spellCheck={false}
              />
              <span className="mt-1.5 block text-[11px] text-slate-600">
                Default: http://127.0.0.1:11434
              </span>
            </label>

            <label className="block">
              <span className="label">Proxy port</span>
              <input
                type="number"
                min={1024}
                max={65535}
                className="input mt-2"
                value={form.proxyPort}
                onChange={(event) =>
                  patch("proxyPort", Number(event.target.value))
                }
              />
              <span className="mt-1.5 block text-[11px] text-slate-600">
                TokenFlow binds only to 127.0.0.1.
              </span>
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-teal-400/15 bg-teal-400/[0.045] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-teal-100">
                  Point your client here
                </p>
                <p className="mt-0.5 text-[11px] text-teal-200/50">
                  Use this as the Ollama base URL. No Ollama server changes are
                  required.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy("base-url", baseUrl)}
                className="btn-secondary border-teal-400/20 bg-teal-400/[0.06] text-teal-200 hover:bg-teal-400/10"
              >
                <Icon
                  name={copied === "base-url" ? "check" : "copy"}
                  className="h-3.5 w-3.5"
                />
                {copied === "base-url" ? "Copied" : "Copy URL"}
              </button>
            </div>
            <code className="mt-2 block truncate rounded-lg bg-black/25 px-2.5 py-1.5 font-mono text-xs text-teal-200">
              {baseUrl}
            </code>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="rounded-xl border border-white/[0.06] bg-[#080d16] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-300">
                      {snippet.title}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-600">
                      {snippet.hint}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy(snippet.id, snippet.code)}
                    className="btn-ghost h-7 w-7 shrink-0 p-0"
                    aria-label={`Copy ${snippet.title} snippet`}
                  >
                    <Icon
                      name={copied === snippet.id ? "check" : "copy"}
                      className="h-3.5 w-3.5"
                    />
                  </button>
                </div>
                <pre className="mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-slate-500">
                  {snippet.code}
                </pre>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="DeepSeek"
          description="TokenFlow polls the official balance endpoint. The key is only sent to the configured DeepSeek API origin."
          icon="wallet"
          action={
            <button
              type="button"
              onClick={() => void handleRefreshStatus()}
              className="btn-ghost"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
              Refresh status
            </button>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">
              <Icon name="key" className="h-3 w-3" />
              {view.hasDeepseekApiKey ? "Key configured" : "No API key"}
            </span>
            {keySourceLabel ? (
              <span className="chip">{keySourceLabel}</span>
            ) : null}
            {deepseek?.lastSuccessAt ? (
              <span className="chip">
                Last synced {formatRelative(deepseek.lastSuccessAt)}
              </span>
            ) : null}
          </div>

          {view.deepseekKeySource === "environment" ? (
            <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.05] px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-100/70">
              A key from the <code className="font-mono">DEEPSEEK_API_KEY</code>{" "}
              environment variable is active and takes precedence over any key
              saved here.
            </div>
          ) : null}

          {keyStorageWarning ? (
            <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.05] px-3.5 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="max-w-3xl text-[11px] leading-relaxed text-amber-100/75">
                  {keyStorageWarning}
                </p>
                <button
                  type="button"
                  onClick={() => void handleRetryKeychain()}
                  disabled={savingKey}
                  className="btn-ghost shrink-0 text-amber-200/80"
                >
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                  Retry keychain
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="label">API key</span>
              <input
                type="password"
                className="input mt-2"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSaveKey();
                  }
                }}
                placeholder={
                  view.hasDeepseekApiKey ? "•••••••• (saved)" : "sk-…"
                }
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveKey()}
                disabled={savingKey}
                className="btn-primary"
              >
                {savingKey ? "Saving…" : "Save key"}
              </button>
              <button
                type="button"
                onClick={() => void handleRemoveKey()}
                disabled={savingKey || !view.hasDeepseekApiKey}
                className="btn-secondary"
              >
                Remove
              </button>
            </div>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Saved keys are stored in your operating system&apos;s credential
            store: macOS Keychain, Windows Credential Manager, or Linux Secret
            Service. On Linux, a Secret Service provider such as gnome-keyring
            must be running. Set{" "}
            <code className="font-mono text-slate-500">DEEPSEEK_API_KEY</code>{" "}
            instead to keep the key out of persistent storage entirely.
          </p>

          {deepseek?.lastError ? (
            <div className="mt-3 rounded-xl border border-rose-500/15 bg-rose-500/[0.05] px-3.5 py-2.5">
              <p className="text-[11px] leading-relaxed text-rose-200/75">
                Last error: {deepseek.lastError}
              </p>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Polling interval (seconds)</span>
              <input
                type="number"
                min={60}
                max={86400}
                className="input mt-2"
                value={form.deepseekPollIntervalSecs}
                onChange={(event) =>
                  patch("deepseekPollIntervalSecs", Number(event.target.value))
                }
              />
              <span className="mt-1.5 block text-[11px] text-slate-600">
                60–86400. The default of 900 respects API rate limits.
              </span>
            </label>

            <label className="block">
              <span className="label">DeepSeek base URL</span>
              <input
                className="input mt-2"
                value={form.deepseekBaseUrl}
                onChange={(event) =>
                  patch("deepseekBaseUrl", event.target.value)
                }
                spellCheck={false}
              />
              <span className="mt-1.5 block text-[11px] text-slate-600">
                HTTPS is required except for localhost testing.
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => {
              void openExternal("https://platform.deepseek.com/api_keys").catch(
                (err) => setError(String(err)),
              );
            }}
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-violet-300 transition-colors hover:text-violet-200"
          >
            Open DeepSeek API keys
            <Icon name="external" className="h-3 w-3" />
          </button>
        </Section>

        <Section
          title="Desktop behavior"
          description="Tray and widget preferences. Window changes apply immediately where possible."
          icon="monitor"
        >
          <div className="divide-y divide-white/[0.05]">
            <Toggle
              label="Start minimized"
              description="Launch into the system tray without opening the dashboard."
              checked={form.startMinimized}
              onChange={(value) => patch("startMinimized", value)}
            />
            <Toggle
              label="Close to tray"
              description="Closing the dashboard hides it; use the tray menu to quit."
              checked={form.closeToTray}
              onChange={(value) => patch("closeToTray", value)}
            />
            <Toggle
              label="Widget always on top"
              description="Keep the floating token snapshot above other windows."
              checked={form.widgetAlwaysOnTop}
              onChange={(value) => patch("widgetAlwaysOnTop", value)}
            />
            <Toggle
              label="Show widget on launch"
              description="Reveal the floating snapshot automatically when TokenFlow starts."
              checked={form.showWidgetOnStart}
              onChange={(value) => patch("showWidgetOnStart", value)}
            />
          </div>
        </Section>

        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Proxy port and upstream changes require an app restart. Other
            preferences are saved immediately.
          </p>
          <button type="submit" disabled={saving} className="btn-primary">
            <Icon name="check" className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>

      <section className="card border-rose-500/15 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/15">
            <Icon name="trash" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-200">
              Danger zone
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Delete all locally recorded Ollama usage and DeepSeek balance
              history. Your settings and API keys are kept.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={clearing}
            className="btn-danger shrink-0"
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
            {clearing ? "Clearing…" : "Clear usage data"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Section({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon: IconName;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex items-start gap-3 border-b border-white/[0.05] pb-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-slate-400 ring-1 ring-white/[0.06]">
          <Icon name={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {description}
          </p>
        </div>
        {action}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div>
        <p className="text-sm text-slate-300">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${
          checked
            ? "border-teal-300/40 bg-teal-400/80"
            : "border-white/10 bg-white/[0.06]"
        }`}
      >
        <span
          className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
            checked ? "left-[3px] translate-x-[20px]" : "left-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse space-y-4">
      {[0, 1, 2].map((index) => (
        <div key={index} className="card p-5">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-white/[0.05]" />
            <div className="space-y-2">
              <div className="h-3 w-28 rounded bg-white/[0.06]" />
              <div className="h-2.5 w-64 rounded bg-white/[0.04]" />
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="h-16 rounded-lg bg-white/[0.03]" />
            <div className="h-16 rounded-lg bg-white/[0.03]" />
          </div>
        </div>
      ))}
    </div>
  );
}
