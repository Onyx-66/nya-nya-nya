from pathlib import Path
p = Path('/home/ubuntu/nya-nya-nya-audit/components/nyascans/admin/TeamRequestsPanel.tsx')
s = p.read_text()
old_request = '<label><span>Decision reason</span><textarea rows={4} value={reasons[request.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} /></label>'
old_claim = '<label><span>Decision reason</span><textarea rows={4} value={reasons[claim.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [claim.id]: event.target.value }))} /></label>'
new_reject_request = '<label><span>Decision reason</span><DecisionReasonEditor id={request.id} decision="REJECT" mode={reasonModes[request.id] ?? ""} value={reasons[request.id] ?? ""} onModeChange={(mode) => setReasonModes((current) => ({ ...current, [request.id]: mode }))} onValueChange={(value) => setReasons((current) => ({ ...current, [request.id]: value }))} /></label>'
new_approve_request = '<label><span>Decision reason</span><DecisionReasonEditor id={request.id} decision="APPROVE" mode={reasonModes[request.id] ?? ""} value={reasons[request.id] ?? ""} onModeChange={(mode) => setReasonModes((current) => ({ ...current, [request.id]: mode }))} onValueChange={(value) => setReasons((current) => ({ ...current, [request.id]: value }))} /></label>'
new_reject_claim = '<label><span>Decision reason</span><DecisionReasonEditor id={claim.id} decision="REJECT" mode={reasonModes[claim.id] ?? ""} value={reasons[claim.id] ?? ""} onModeChange={(mode) => setReasonModes((current) => ({ ...current, [claim.id]: mode }))} onValueChange={(value) => setReasons((current) => ({ ...current, [claim.id]: value }))} /></label>'
if s.count(old_request) != 2 or s.count(old_claim) != 1:
    raise SystemExit(f'unexpected counts request={s.count(old_request)} claim={s.count(old_claim)}')
first, second = s.split(old_request, 1)
s = first + new_reject_request + second
first, second = s.split(old_claim, 1)
s = first + new_reject_claim + second
first, second = s.split(old_request, 1)
s = first + new_approve_request + second
p.write_text(s)
print('patched decision reason editors')
