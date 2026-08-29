/**
 * A compact advisory card for a Predictive Insight (ADR-041).
 *
 * It states a level, the reasons behind it, and nothing else — no action button,
 * because a prediction never acts. It renders only for MEDIUM/HIGH by default
 * (`minLevel`), so it never competes with the primary trip flow when there is
 * nothing to say.
 */
import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { RiskAssessment, RiskLevel } from '../lib/api';
import { Txt } from './ui';
import { colors, radius, space } from '../theme';

const RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

const TONE: Record<RiskLevel, { bg: string; fg: string; icon: 'info' | 'warning' | 'error' }> = {
  LOW: { bg: colors.surfaceContainerLow, fg: colors.onSurfaceVariant, icon: 'info' },
  MEDIUM: { bg: colors.warningContainer, fg: colors.onWarningContainer, icon: 'warning' },
  HIGH: { bg: colors.errorContainer, fg: colors.onErrorContainer, icon: 'error' },
};

const LEVEL_WORD: Record<RiskLevel, string> = {
  LOW: 'Low risk',
  MEDIUM: 'Medium risk',
  HIGH: 'High risk',
};

export function InsightCard({
  assessment,
  title,
  minLevel = 'MEDIUM',
  maxReasons = 2,
}: {
  assessment: RiskAssessment | null | undefined;
  title: string;
  minLevel?: RiskLevel;
  maxReasons?: number;
}) {
  if (!assessment) return null;
  if (RANK[assessment.level] < RANK[minLevel]) return null;

  const tone = TONE[assessment.level];
  const reasons = assessment.reasons.slice(0, maxReasons);

  return (
    <View
      style={{
        backgroundColor: tone.bg,
        borderRadius: radius.md,
        padding: space.gutter,
        gap: space.xs,
      }}
      accessibilityRole="summary"
      accessibilityLabel={`${title}: ${LEVEL_WORD[assessment.level]}. ${reasons.join(' ')}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <MaterialIcons name={tone.icon} size={18} color={tone.fg} />
        <Txt variant="labelLg" color={tone.fg} style={{ flex: 1 }}>
          {title} — {LEVEL_WORD[assessment.level]}
        </Txt>
        {assessment.confidence === 'LOW' ? (
          <Txt variant="labelSm" color={tone.fg}>
            low confidence
          </Txt>
        ) : null}
      </View>

      {reasons.map((reason) => (
        <Txt key={reason} variant="bodyMd" color={tone.fg}>
          • {reason}
        </Txt>
      ))}

      <Txt variant="labelSm" color={tone.fg} style={{ opacity: 0.8, marginTop: space.xs }}>
        Advisory only — it does not change your trip, price or driver.
      </Txt>
    </View>
  );
}
