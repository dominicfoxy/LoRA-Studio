import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle, XCircle, FolderOpen } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore } from "../store";

type TestState = "idle" | "testing" | "ok" | "fail";

export default function SettingsPage() {
  const { settings, setSettings } = useStore();
  const [forgeTest, setForgeTest] = useState<TestState>("idle");
  const [runpodTest, setRunpodTest] = useState<TestState>("idle");
  const [localScale, setLocalScale] = useState(settings.uiScale ?? 1.0);

  const testForge = async () => {
    setForgeTest("testing");
    try {
      const res = await invoke("forge_get_models", { baseUrl: settings.forgeUrl });
      setForgeTest("ok");
    } catch {
      setForgeTest("fail");
    }
  };

  const testRunpod = async () => {
    setRunpodTest("testing");
    try {
      const json = await invoke<{ data?: { myself?: { id?: string } } }>("runpod_graphql", {
        apiKey: settings.runpodApiKey,
        query: "{ myself { id } }",
        variables: {},
      });
      setRunpodTest(json.data?.myself?.id ? "ok" : "fail");
    } catch {
      setRunpodTest("fail");
    }
  };

  const pickDefaultDir = async () => {
    const selected = await invoke<string | null>("pick_directory");
    if (selected) setSettings({ defaultOutputDir: selected });
  };

  const StatusIcon = ({ state }: { state: TestState }) => {
    if (state === "ok") return <CheckCircle size={14} color="var(--green)" />;
    if (state === "fail") return <XCircle size={14} color="var(--red)" />;
    if (state === "testing") return <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--accent)" }}>testing…</span>;
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader title="Settings" subtitle="API endpoints, keys, and defaults" />
      <div style={{ flex: 1, overflow: "auto", padding: "28px" }}>
        <div style={{ maxWidth: "560px" }}>

          {/* UI Scale */}
          <section style={{ marginBottom: "32px" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid var(--border)" }}>
              Display
            </div>
            <div className="section-label">UI Scale</div>
            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "8px" }}>
              <input
                type="range"
                min="0.7"
                max="1.5"
                step="0.05"
                value={localScale}
                onChange={(e) => setLocalScale(parseFloat(e.target.value))}
                onPointerUp={(e) => setSettings({ uiScale: parseFloat((e.target as HTMLInputElement).value) })}
                style={{ flex: 1, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
              />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--accent-bright)", width: "42px", textAlign: "right", flexShrink: 0 }}>
                {Math.round(localScale * 100)}%
              </span>
              <button className="btn-ghost" onClick={() => { setLocalScale(1.0); setSettings({ uiScale: 1.0 }); }} style={{ padding: "4px 10px", fontSize: "11px", flexShrink: 0 }}>
                Reset
              </button>
            </div>
          </section>

          {/* Forge WebUI */}
          <section style={{ marginBottom: "32px" }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--text-primary)",
              marginBottom: "16px",
              paddingBottom: "8px",
              borderBottom: "1px solid var(--border)",
            }}>Forge WebUI</div>

            <div style={{ marginBottom: "12px" }}>
              <div className="section-label">URL</div>
              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <input
                  style={{ flex: 1 }}
                  value={settings.forgeUrl}
                  onChange={(e) => setSettings({ forgeUrl: e.target.value })}
                  placeholder="http://localhost:7860"
                />
                <button className="btn-ghost" onClick={testForge} style={{ flexShrink: 0 }}>
                  Test
                </button>
                <div style={{ alignSelf: "center", width: "80px" }}>
                  <StatusIcon state={forgeTest} />
                  {forgeTest === "ok" && <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--green)", marginLeft: "4px" }}>connected</span>}
                  {forgeTest === "fail" && <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--red)", marginLeft: "4px" }}>failed</span>}
                </div>
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                Make sure Forge is running with --api flag enabled
              </div>
            </div>
          </section>

          {/* ComfyUI */}
          <section style={{ marginBottom: "32px" }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--text-primary)",
              marginBottom: "16px",
              paddingBottom: "8px",
              borderBottom: "1px solid var(--border)",
            }}>ComfyUI</div>
            <div style={{ marginBottom: "12px" }}>
              <div className="section-label">URL</div>
              <input
                style={{ width: "100%", marginTop: "4px" }}
                value={settings.comfyUrl}
                onChange={(e) => setSettings({ comfyUrl: e.target.value })}
                placeholder="http://localhost:8188"
              />
            </div>
          </section>

          {/* RunPod */}
          <section style={{ marginBottom: "32px" }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--text-primary)",
              marginBottom: "16px",
              paddingBottom: "8px",
              borderBottom: "1px solid var(--border)",
            }}>RunPod</div>

            <div style={{ marginBottom: "12px" }}>
              <div className="section-label">API Key</div>
              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <input
                  type="password"
                  style={{ flex: 1 }}
                  value={settings.runpodApiKey}
                  onChange={(e) => setSettings({ runpodApiKey: e.target.value })}
                  placeholder="rp_xxxxxxxxxxxx"
                />
                <button className="btn-ghost" onClick={testRunpod} style={{ flexShrink: 0 }}>
                  Test
                </button>
                <div style={{ alignSelf: "center", width: "80px" }}>
                  <StatusIcon state={runpodTest} />
                  {runpodTest === "ok" && <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--green)", marginLeft: "4px" }}>valid</span>}
                  {runpodTest === "fail" && <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--red)", marginLeft: "4px" }}>invalid</span>}
                </div>
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                Get your API key at runpod.io/console/user/settings
              </div>
            </div>
          </section>

          {/* Defaults */}
          <section>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--text-primary)",
              marginBottom: "16px",
              paddingBottom: "8px",
              borderBottom: "1px solid var(--border)",
            }}>Defaults</div>

            <div style={{ marginBottom: "12px" }}>
              <div className="section-label">Default Output Directory</div>
              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <input
                  style={{ flex: 1 }}
                  value={settings.defaultOutputDir}
                  onChange={(e) => setSettings({ defaultOutputDir: e.target.value })}
                  placeholder="/mnt/nas/ai/datasets"
                />
                <button className="btn-ghost" onClick={pickDefaultDir} style={{ flexShrink: 0 }}>
                  <FolderOpen size={13} style={{ display: "inline", marginRight: "5px" }} />
                  Browse
                </button>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
