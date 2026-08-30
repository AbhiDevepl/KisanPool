import { Router } from 'express';
import { z } from 'zod';
import { ApiError, ok } from '../../lib/envelope';
import { asyncHandler } from '../../middleware/error';
import { requireAdmin, requireAuth, type AuthedRequest } from '../../middleware/auth';
import { upload, uploadFile, readEncryptedUpload } from '../../lib/upload';
import { DOCUMENT_TYPES, VERIFICATION_STATUSES } from '@kisanpool/shared';
import { KycDocument } from '../../models';
import { kycStatusFor, reconcileVehicleVerification } from './service';

export const documentsRouter = Router();

documentsRouter.post(
  '/',
  requireAuth,
  upload.single('file'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { type } = z.object({ type: z.enum(DOCUMENT_TYPES) }).parse(req.body);
    const fileUrl = await uploadFile(req.file, `kyc/${req.userId}`);

    // re-uploading a rejected document replaces it and returns to PENDING
    const doc = await KycDocument.findOneAndUpdate(
      { userId: req.userId, type },
      { fileUrl, status: 'PENDING', reviewedAt: undefined, rejectionReason: undefined },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    await reconcileVehicleVerification(req.userId);
    ok(res, doc, 201);
  }),
);

documentsRouter.get(
  '/me',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const documents = await KycDocument.find({ userId: req.userId });
    ok(res, { documents, kyc: await kycStatusFor(req.userId) });
  }),
);

/**
 * Serves a locally-stored KYC document, decrypting it on the fly (ADR-042).
 * A transporter may read only their own files; an admin may read anyone's.
 * Cloudinary-hosted docs keep their absolute URL and never hit this route.
 */
documentsRouter.get(
  '/file/*',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rel = (req.params as unknown as string[])[0] ?? '';
    const urlPath = `/uploads/${rel}`;

    const owned = rel.startsWith(`kyc/${req.userId}/`);
    if (!owned && !req.isAdmin) throw new ApiError('AUTH_FORBIDDEN', 'Not your document.');

    let file;
    try {
      file = await readEncryptedUpload(urlPath);
    } catch {
      throw new ApiError('RESOURCE_NOT_FOUND', 'Document not found.');
    }
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(file.filename);
    res.send(file.buffer);
  }),
);

/**
 * Operator-only. Previously this was merely `requireAuth`, which let any signed-in
 * transporter approve their own documents and walk straight through the KYC gate.
 */
documentsRouter.patch(
  '/:id/review',
  requireAdmin,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { status, reason } = z
      .object({ status: z.enum(VERIFICATION_STATUSES), reason: z.string().optional() })
      .parse(req.body);

    const doc = await KycDocument.findById(req.params.id);
    if (!doc) throw new ApiError('RESOURCE_NOT_FOUND', 'Document not found.');

    doc.status = status;
    doc.reviewedAt = new Date();
    doc.rejectionReason = status === 'REJECTED' ? reason : undefined;
    await doc.save();

    await reconcileVehicleVerification(String(doc.userId));
    ok(res, doc);
  }),
);
