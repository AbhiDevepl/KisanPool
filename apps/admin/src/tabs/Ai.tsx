/**
 * A3 · Servo AI activity.
 *
 * The language mix is the headline. Servo exists so a farmer who would not use a
 * form in English can still book a trip by speaking Marathi — so "how many
 * sessions are not in English" is the number that says whether it is working.
 */
import { api } from '../api';
import {
  Badge,
  Empty,
  ErrorBox,
  Freshness,
  Meter,
  Section,
  SkeletonTable,
  Stat,
  Toolbar,
  useRemote,
  when,
} from '../ui';

const LANGUAGE_NAME: Record<string, string> = {
  mr: 'Marathi',
  hi: 'Hindi',
  en: 'English',
};

const LANGUAGE_COLOR: Record<string, string> = {
  mr: 'var(--primary)',
  hi: 'var(--primary-container)',
  en: 'var(--outline)',
};

export function AiTab() {
  const ai = useRemote(() => api.ai(), 60_000);

  const data = ai.data;
  const languages = Object.entries(data?.byLanguage ?? {}).sort((a, b) => b[1] - a[1]);
  const totalSessions = data?.totals.sessions ?? 0;
  const nonEnglish = languages
    .filter(([code]) => code !== 'en')
    .reduce((sum, [, count]) => sum + count, 0);

  return (
    <>
      <Toolbar>
        <div className="label-sm muted">Servo AI — voice and chat sessions</div>
        <Freshness at={ai.refreshedAt} onRefresh={ai.refresh} />
      </Toolbar>

      {ai.loading ? (
        <SkeletonTable />
      ) : ai.error ? (
        <ErrorBox error={ai.error} onRetry={ai.refresh} />
      ) : !data ? null : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 'var(--s-md)' }}>
            <Stat label="Sessions" value={String(data.totals.sessions)} />
            <Stat label="Messages" value={String(data.totals.turns)} hint={`${data.totals.avgTurns} per session`} />
            <Stat
              label="In an Indian language"
              value={
                totalSessions ? `${Math.round((nonEnglish / totalSessions) * 100)}%` : '—'
              }
              hint={`${nonEnglish} of ${totalSessions} sessions`}
            />
            <Stat
              label="Awaiting a spoken yes"
              value={String(data.totals.awaitingConfirmation)}
              hint="Never acts without confirmation"
            />
          </div>

          <Section title="Language usage">
            <div className="card">
              {languages.length === 0 ? (
                <div className="muted body-md">No sessions yet.</div>
              ) : (
                <>
                  <Meter
                    segments={languages.map(([code, count]) => ({
                      pct: totalSessions ? (count / totalSessions) * 100 : 0,
                      color: LANGUAGE_COLOR[code] ?? 'var(--surface-high)',
                    }))}
                  />
                  <div className="row" style={{ gap: 'var(--s-lg)', marginTop: 'var(--s-gutter)', flexWrap: 'wrap' }}>
                    {languages.map(([code, count]) => (
                      <div key={code} className="row">
                        <span
                          className="dot"
                          style={{ background: LANGUAGE_COLOR[code] ?? 'var(--surface-high)' }}
                        />
                        <span className="body-md">{LANGUAGE_NAME[code] ?? code}</span>
                        <span className="label-sm muted">{count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Section>

          <Section title="Recent sessions">
            {data.recent.length === 0 ? (
              <Empty message="Nobody has used the assistant yet. Sessions appear here as farmers start speaking to Servo." />
            ) : (
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Language</th>
                      <th style={{ textAlign: 'right' }}>Turns</th>
                      <th>Last message</th>
                      <th>Pending</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((session) => (
                      <tr key={session._id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{session.user?.name ?? 'Unknown'}</div>
                          <div className="label-sm muted">{session.user?.role ?? ''}</div>
                        </td>
                        <td>{LANGUAGE_NAME[session.language] ?? session.language}</td>
                        <td style={{ textAlign: 'right' }}>{session.turns}</td>
                        <td className="muted" style={{ maxWidth: 320 }}>
                          {session.lastMessage ? (
                            <>
                              <span className="label-sm">{session.lastRole === 'user' ? '👤 ' : '◍ '}</span>
                              {session.lastMessage}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {session.pending ? (
                            <Badge value="PENDING" />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="label-sm muted">{when(session.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
