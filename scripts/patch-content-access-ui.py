from pathlib import Path
p = Path('/home/ubuntu/nya-nya-nya-audit/components/nyascans/admin/ContentVisibilityPanel.tsx')
s = p.read_text()
start = s.index('          <form className="settings-section-grid" onSubmit={saveDefaults}>')
end = s.index('          <div className="control-section-heading">', start)
replacement = '''          <section className="paid-mode-switcher" aria-labelledby="paid-mode-heading">
            <div className="control-section-heading">
              <div><span>Paid system style</span><h3 id="paid-mode-heading">Choose how paid chapters are assigned</h3></div>
            </div>
            <div className="paid-mode-toggle" role="group" aria-label="Paid system style">
              {(["NORMAL", "LAST_PAID"] as const).map((mode) => (
                <button key={mode} type="button" className={rulesDraft.mode === mode ? "is-active" : ""} aria-pressed={rulesDraft.mode === mode} onClick={() => setRulesDraft({ ...rulesDraft, mode })}>
                  <strong>{mode === "NORMAL" ? "Normal" : "Last Paid"}</strong>
                  <span>{mode === "NORMAL" ? "Choose each chapter manually" : "Lock the latest chapters automatically"}</span>
                </button>
              ))}
            </div>
            {rulesDraft.mode === "NORMAL" ? (
              <div className="paid-mode-details paid-mode-details--normal">
                <div><strong>Manual chapter access</strong><p>Administrators can make any chapter Paid or Free from Chapter Access.</p></div>
                <label><span>Default access for new chapters</span><UnifiedSingleSelect value={rulesDraft.defaultAccessType} onChange={(event) => setRulesDraft({ ...rulesDraft, defaultAccessType: event.target.value as "FREE" | "PAID" })}><option value="FREE">Free</option><option value="PAID">Paid</option></UnifiedSingleSelect></label>
                <label><span>Default Paw price</span><input type="number" min={0} step={1} value={rulesDraft.defaultPriceOnyx} disabled={rulesDraft.defaultAccessType === "FREE"} onChange={(event) => setRulesDraft({ ...rulesDraft, defaultPriceOnyx: Number(event.target.value) })} /></label>
                <div className="admin-sticky-actions store-admin-wide"><small>Normal mode leaves every chapter’s Paid/Free choice under administrator control.</small><button className="button button-primary" type="submit" form="paid-default-policy-form" disabled={!rulesDirty || Boolean(busy)}>Save default policy</button></div>
              </div>
            ) : (
              <div className="paid-mode-details paid-mode-details--last-paid">
                <div className="paid-policy-callout"><LockKey size={18} /><div><strong>Latest chapters are automatic</strong><p>Only public chapters are eligible. A series without custom settings uses the global default: one chapter at 50 Paws.</p></div></div>
                <div className="paid-mode-default-grid">
                  <label><span>Default Auto-Free period</span><input type="number" min={1} step={1} value={rulesDraft.autoFreeAfterDays ?? 7} onChange={(event) => setRulesDraft({ ...rulesDraft, autoFreeAfterDays: Number(event.target.value) })} /></label>
                  <label><span>Default price per chapter</span><input type="number" min={1} step={1} value={rulesDraft.defaultPriceOnyx || 50} onChange={(event) => setRulesDraft({ ...rulesDraft, defaultPriceOnyx: Number(event.target.value) })} /></label>
                </div>
                <div className="admin-sticky-actions store-admin-wide"><small>Save global defaults first, then configure individual series below.</small><button className="button button-primary" type="submit" form="paid-default-policy-form" disabled={!rulesDirty || Boolean(busy)}>Save Last Paid defaults</button></div>
              </div>
            )}
            <form id="paid-default-policy-form" onSubmit={saveDefaults} hidden />
          </section>

          <SeriesPaidPolicyPanel mode={rulesDraft.mode} defaultAutoFreeAfterDays={rulesDraft.autoFreeAfterDays ?? 7} defaultPriceOnyx={rulesDraft.defaultPriceOnyx || 50} />

'''
p.write_text(s[:start] + replacement + s[end:])
