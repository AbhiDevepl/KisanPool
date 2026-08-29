import { KycDocument, Vehicle } from '../../models';

/**
 * RC + DL approved flips the vehicle to VERIFIED, which is the only thing that
 * makes it visible to matching (ADR-010). PAN gates payouts, not matching.
 */
export async function reconcileVehicleVerification(userId: string): Promise<void> {
  const docs = await KycDocument.find({ userId });
  const approved = new Set(docs.filter((d) => d.status === 'VERIFIED').map((d) => d.type));
  const rejected = docs.some((d) => d.status === 'REJECTED' && (d.type === 'RC' || d.type === 'DL'));

  const vehicle = await Vehicle.findOne({ ownerId: userId });
  if (!vehicle) return;

  if (rejected) {
    vehicle.verificationStatus = 'REJECTED';
    vehicle.status = 'OFFLINE';
  } else if (approved.has('RC') && approved.has('DL')) {
    vehicle.verificationStatus = 'VERIFIED';
  } else {
    vehicle.verificationStatus = 'PENDING';
    vehicle.status = 'OFFLINE';
  }

  await vehicle.save();
}

/** The KYC state the transporter's dashboard banner reads. */
export async function kycStatusFor(userId: string) {
  const docs = await KycDocument.find({ userId });
  const byType = Object.fromEntries(docs.map((d) => [d.type, d.status]));
  const submitted = docs.length > 0;
  const rcDlApproved = byType.RC === 'VERIFIED' && byType.DL === 'VERIFIED';
  const anyRejected = docs.some((d) => d.status === 'REJECTED');

  return {
    submitted,
    documents: byType,
    verified: rcDlApproved,
    rejected: anyRejected,
    panSubmitted: Boolean(byType.PAN),
  };
}
