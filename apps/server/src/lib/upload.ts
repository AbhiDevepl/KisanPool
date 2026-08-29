import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config';
import { ApiError } from './envelope';

if (config.cloudinaryUrl) {
  cloudinary.config({ secure: true }); // reads CLOUDINARY_URL from the environment
}

/** Files are held in memory only long enough to forward them to object storage (ADR-016). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const LOCAL_DIR = path.resolve(__dirname, '../../uploads');

/**
 * Uploads to Cloudinary, or to a local folder when no CLOUDINARY_URL is set so the
 * demo runs without an account. Either way the caller only ever sees a URL.
 */
export async function uploadFile(
  file: Express.Multer.File | undefined,
  folder: string,
): Promise<string> {
  if (!file) throw new ApiError('VALIDATION_ERROR', 'file: a file is required');

  if (!config.cloudinaryUrl) {
    await fs.mkdir(path.join(LOCAL_DIR, folder), { recursive: true });
    const name = `${randomUUID()}${path.extname(file.originalname) || '.jpg'}`;
    await fs.writeFile(path.join(LOCAL_DIR, folder, name), file.buffer);
    return `/uploads/${folder}/${name}`;
  }

  try {
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `kisanpool/${folder}`, resource_type: 'image' },
        (err, res) => (err || !res ? reject(err) : resolve(res as { secure_url: string })),
      );
      stream.end(file.buffer);
    });
    return result.secure_url;
  } catch (err) {
    console.error('[upload] cloudinary failed', err);
    throw new ApiError('EXTERNAL_SERVICE_ERROR', 'Could not upload that file. Please try again.');
  }
}

export const localUploadsDir = LOCAL_DIR;
