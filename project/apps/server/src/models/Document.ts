import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { DOCUMENT_TYPES, VERIFICATION_STATUSES } from '@kisanpool/shared';

const documentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    fileUrl: { type: String, required: true }, // Cloudinary/S3 URL — never the binary (ADR-016)
    status: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING' },
    reviewedAt: { type: Date, default: undefined },
    rejectionReason: { type: String, default: undefined },
  },
  { timestamps: true },
);

export type DocumentAttrs = InferSchemaType<typeof documentSchema>;
export type KycDocumentDoc = HydratedDocument<DocumentAttrs>;
export const KycDocument = model('Document', documentSchema);
