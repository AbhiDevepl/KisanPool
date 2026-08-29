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
import { toAppError } from '../../lib/errors';
import { Banner, Button, Card, Field, Header, Loading, Screen, StatusBadge, Txt } from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { colors, radius, space } from '../../theme';

const DOCS = [
  { type: 'RC', label: 'Registration Certificate (RC)', gate: 'Required to receive trips' },
  { type: 'DL', label: 'Driving Licence (DL)', gate: 'Required to receive trips' },
  { type: 'PAN', label: 'PAN card', gate: 'Required to receive payouts' },
] as const;

export default function Kyc() {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const [pan, setPan] = useState('');
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
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

  const saveBank = async (): Promise<void> => {
    setSavingBank(true);
    setError(undefined);
    try {
      await api.payoutOnboarding({
        panNumber: pan.toUpperCase(),
        bankAccountNumber: account,
        ifsc: ifsc.toUpperCase(),
      });
      setBankDone(true);
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setSavingBank(false);
    }
  };

  return (
    <Screen footer={<Button label="Done" onPress={() => router.replace('/(auth)/success')} />}>
      <Header title="Verify your documents" subtitle="कागदपत्रे तपासा" />

      {loading ? null : verified ? (
        <Banner tone="primary">
          <Txt variant="labelLg" color={colors.onPrimary}>
            Your documents are verified
          </Txt>
          <Txt variant="bodyMd" color={colors.onPrimaryContainer} style={{ marginTop: space.xs }}>
            You can go online and start receiving trip requests.
          </Txt>
        </Banner>
      ) : (
        <Banner tone="warning">
          <Txt variant="labelLg" color={colors.onWarningContainer}>
            You'll start receiving trip requests once your documents are verified
          </Txt>
          <Txt variant="bodyMd" color={colors.onWarningContainer} style={{ marginTop: space.xs }}>
            Your RC and driving licence must both be approved before your vehicle appears to
            farmers. PAN and bank details are needed to receive payouts.
          </Txt>
        </Banner>
      )}

      {loading ? <Loading label="Checking your documents…" /> : null}
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
                <Txt variant="labelLg">{doc.label}</Txt>
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  {doc.gate}
                </Txt>
              </View>
              {status ? <StatusBadge status={status} /> : null}
            </View>

            {status === 'REJECTED' ? (
              <Txt variant="labelSm" color={colors.error} style={{ marginTop: space.sm }}>
                Rejected{reasons[doc.type] ? `: ${reasons[doc.type]}` : ''} — please upload a
                clearer photo.
              </Txt>
            ) : null}

            <Button
              label={
                status === 'REJECTED'
                  ? 'Re-upload'
                  : status
                    ? 'Replace'
                    : 'Upload'
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
        Bank details for payouts
      </Txt>
      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
        These go straight to our payment partner. KisanPool never stores your account number.
      </Txt>

      {bankDone ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="check-circle" size={22} color={colors.primary} />
            <Txt variant="labelLg">Bank details saved</Txt>
          </View>
        </Card>
      ) : (
        <>
          <Field
            label="PAN number"
            value={pan}
            onChangeText={setPan}
            autoCapitalize="characters"
            placeholder="ABCDE1234F"
          />
          <Field
            label="Bank account number"
            value={account}
            onChangeText={(text) => setAccount(text.replace(/\D/g, ''))}
            keyboardType="number-pad"
            placeholder="Account number"
          />
          <Field
            label="IFSC code"
            value={ifsc}
            onChangeText={setIfsc}
            autoCapitalize="characters"
            placeholder="HDFC0001234"
            error={error}
          />
          <Button
            label="Save bank details"
            variant="secondary"
            icon="account-balance"
            loading={savingBank}
            disabled={!pan || !account || !ifsc}
            onPress={() => void saveBank()}
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
