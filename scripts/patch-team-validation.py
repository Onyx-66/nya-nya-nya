from pathlib import Path
import re

p = Path('/home/ubuntu/nya-nya-nya-audit/components/nyascans/upload/TeamCreationPanel.tsx')
s = p.read_text()
s = s.replace(
    'const [cropSource, setCropSource] = useState<CropSource | null>(null);',
    'const [cropSource, setCropSource] = useState<CropSource | null>(null); const [invalidFields, setInvalidFields] = useState<string[]>([]);',
)
s = s.replace(
    'function update(field: keyof FormValues, value: string | File | null) { setForm((current) => ({ ...current, [field]: value })); setMessage(null); }',
    'function update(field: keyof FormValues, value: string | File | null) { setForm((current) => ({ ...current, [field]: value })); setInvalidFields((current) => current.filter((item) => item != field)); setMessage(null); }',
)
pattern = r'  async function submit\(event: FormEvent<HTMLFormElement>\) \{.*?\n  return <section'
replacement = '''  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing: string[] = [];
    if (!form.name.trim()) missing.push("name");
    if (form.description.trim().length < 20) missing.push("description");
    if (!form.logo) missing.push("logo");
    if (!form.banner) missing.push("banner");
    if (!form.externalLinks.some((link) => link.url.trim())) missing.push("externalLinks");
    if (form.reason.trim().length < 20) missing.push("reason");
    if (missing.length) { setInvalidFields(missing); setMessage({ kind: "error", text: "Complete the highlighted Create Team fields before sending your request." }); return; }
    setInvalidFields([]); setBusy(true); setMessage(null);
    try {
      const body = new FormData();
      body.set("name", form.name); body.set("description", form.description); body.set("reason", form.reason);
      body.set("externalLinks", JSON.stringify(form.externalLinks.filter((link) => link.url.trim())));
      body.set("memberEmails", JSON.stringify(form.memberEmails.filter((email) => email.trim())));
      body.set("logo", form.logo); body.set("banner", form.banner);
      const response = await fetch("/api/v1/team-creation-requests", { method: "POST", body });
      const payload = await response.json() as { data?: { requests?: TeamCreationRequest[] }; error?: { message?: string; fields?: Array<{ path?: string; message?: string }> } };
      if (!response.ok || !payload.data) {
        const fields = payload.error?.fields ?? [];
        setInvalidFields(fields.map((field) => field.path ?? "").filter(Boolean));
        throw new Error(fields[0]?.message ?? payload.error?.message ?? "The team request could not be submitted.");
      }
      setRequests(payload.data.requests ?? []); setForm(emptyForm); setMemberPreviews({}); setInvalidFields([]);
      setMessage({ kind: "success", text: "Create Team request sent successfully. An administrator will review it." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "The Create Team request could not be submitted." }); }
    finally { setBusy(false); }
  }
  return <section'''
s2, n = re.subn(pattern, replacement, s, flags=re.S)
if n != 1:
    raise SystemExit(f'submit replacement count={n}')
p.write_text(s2)
print('patched validation')
