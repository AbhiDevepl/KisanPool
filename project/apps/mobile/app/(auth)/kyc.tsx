/**
 * KYC upload — RC, DL, PAN plus bank details. RC + DL gate matching; PAN and the
 * bank account gate payouts (ADR-010, ADR-007).
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { toAppError } from '../../lib/errors';
import { Banner, Button, Card, Field, Header, Loading, Screen, StatusBadge, Txt } from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { colors, radius, space } from '../../theme';

const DOCS = [
  { type: 'RC', labelKey: 'kyc.doc.RC', gateKey: 'kyc.gate.trips' },
  { type: 'DL', labelKey: 'kyc.doc.DL', gateKey: 'kyc.gate.trips' },
  { type: 'PAN', labelKey: 'kyc.doc.PAN', gateKey: 'kyc.gate.payouts' },
] as const;

export default function Kyc() {
  const router = useRouter();
  const { t } = useT();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const [upiId, setUpiId] = useState('');
  const [savingBank, setSavingBank] = useState(false);
  const [bankDone, setBankDone] = useState(false);

  const load = async (): Promise<void> => {
    setLoadError(undefined);
    try {
      const { documents, kyc } = await api.myDocuments();
      setStatuses(kyc.documents);
      setVerified(kyc.verified);
      // a rejection the driver cannot read is a dead end
      setReasons(
        Object.fromEntries(
          documents
            .filter((d) => d.status === 'REJECTED')
            .map((d) => [d.type, d.rejectionReason ?? '']),
        ),
      );
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const pickAndUpload = async (type: string): Promise<void> => {
    setError(undefined);
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    setUploading(type);
    try {
      await api.uploadDocument(type, {
        uri: asset.uri,
        name: asset.fileName ?? `${type}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      await load();
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setUploading(null);
    }
  };

  const saveUpi = async (): Promise<void> => {
    setSavingBank(true);
    setError(undefined);
    try {
      await api.payoutOnboarding({ upiId: upiId.trim() });
      setBankDone(true);
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setSavingBank(false);
    }
  };

  return (
    <Screen footer={<Button label={t('common.done')} onPress={() => router.replace('/(auth)/success')} />}>
      <Header title={t('kyc.title')} subtitle={t('kyc.titleNative')} />

      {loading ? null : verified ? (
        <Banner tone="primary">
          <Txt variant="labelLg" color={colors.onPrimary}>
            {t('kyc.verifiedTitle')}
          </Txt>
          <Txt variant="bodyMd" color={colors.onPrimaryContainer} style={{ marginTop: space.xs }}>
            {t('kyc.verifiedBody')}
          </Txt>
        </Banner>
      ) : (
        <Banner tone="warning">
          <Txt variant="labelLg" color={colors.onWarningContainer}>
            {t('kyc.pendingTitle')}
          </Txt>
          <Txt variant="bodyMd" color={colors.onWarningContainer} style={{ marginTop: space.xs }}>
            {t('kyc.pendingBody')}
          </Txt>
        </Banner>
      )}

      {loading ? <Loading label={t('kyc.checking')} /> : null}
      {loadError ? <ErrorView error={loadError} onRetry={() => void load()} /> : null}

      {DOCS.map((doc) => {
        const status = statuses[doc.type];
        return (
          <Card key={doc.type}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
              <View style={s_icon}>
                <MaterialIcons
                  name={status === 'VERIFIED' ? 'verified' : 'description'}
                  size={24}
                  color={status === 'VERIFIED' ? colors.primary : colors.onSurfaceVariant}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="labelLg">{t(doc.labelKey)}</Txt>
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  {t(doc.gateKey)}
                </Txt>
              </View>
              {status ? <StatusBadge status={status} /> : null}
            </View>

            {status === 'REJECTED' ? (
              <Txt variant="labelSm" color={colors.error} style={{ marginTop: space.sm }}>
                {t('kyc.rejected', {
                  reason: reasons[doc.type] ? `: ${reasons[doc.type]}` : '',
                })}
              </Txt>
            ) : null}

            <Button
              label={
                status === 'REJECTED'
                  ? t('kyc.reupload')
                  : status
                    ? t('kyc.replace')
                    : t('kyc.upload')
              }
              variant="secondary"
              icon="upload"
              loading={uploading === doc.type}
              onPress={() => void pickAndUpload(doc.type)}
              style={{ marginTop: space.gutter }}
            />
          </Card>
        );
      })}

      <Txt variant="headlineMd" style={{ marginTop: space.md, marginBottom: space.sm }}>
        {t('kyc.upiTitle')}
      </Txt>
      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
        {t('kyc.upiHelp')}
      </Txt>

      {bankDone ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="check-circle" size={22} color={colors.primary} />
            <Txt variant="labelLg">{t('kyc.upiSaved')}</Txt>
          </View>
        </Card>
      ) : (
        <>
          <Field
            label={t('kyc.upiLabel')}
            value={upiId}
            onChangeText={setUpiId}
            autoCapitalize="none"
            placeholder={t('kyc.upiPlaceholder')}
            error={error}
          />
          <Button
            label={t('kyc.saveUpi')}
            variant="secondary"
            icon="account-balance-wallet"
            loading={savingBank}
            disabled={!/^[^\s@]{2,}@[a-zA-Z]{2,}$/.test(upiId.trim())}
            onPress={() => void saveUpi()}
          />
        </>
      )}
    </Screen>
  );
}

const s_icon = {
  width: 48,
  height: 48,
  borderRadius: radius.md,
  backgroundColor: colors.surfaceContainer,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
