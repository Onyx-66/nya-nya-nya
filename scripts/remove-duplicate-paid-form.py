from pathlib import Path
p=Path('/home/ubuntu/nya-nya-nya-audit/components/nyascans/admin/ContentVisibilityPanel.tsx')
s=p.read_text()
anchor='          <SeriesPaidPolicyPanel mode={rulesDraft.mode} defaultAutoFreeAfterDays={rulesDraft.autoFreeAfterDays ?? 7} defaultPriceOnyx={rulesDraft.defaultPriceOnyx || 50} />\n\n'
start=s.index(anchor)+len(anchor)
first=s.index('          <div className="control-section-heading">', start)
second=s.index('          <div className="control-section-heading">', first+1)
s=s[:start]+s[second:]
p.write_text(s)
