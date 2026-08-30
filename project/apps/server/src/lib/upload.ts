import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
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

// --- At-rest encryption for locally-stored documents (ADR-042) --------------
// AES-256-GCM. Encrypted files carry a `.enc` extension and the layout
// [ 12-byte IV | 16-byte auth tag | ciphertext ]. The key is a SHA-256 of the
// configured secret so any secret length works.
const ENC_KEY = createHash('sha256').update(config.uploadsEncryptionKey).digest();
const ENC_EXT = '.enc';

function encryptBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decryptBuffer(blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const body = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Reads a locally-stored document given its `/uploads/...` URL path. Files written
 * with a `.enc` extension are AES-decrypted; anything else (e.g. documents
 * uploaded before ADR-042) is returned as-is so it still opens.
 */
export async function readEncryptedUpload(
  urlPath: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const rel = urlPath.replace(/^\/uploads\//, '');
  const abs = path.join(LOCAL_DIR, rel);
  if (!abs.startsWith(LOCAL_DIR + path.sep)) {
    throw new ApiError('VALIDATION_ERROR', 'Invalid document path.');
  }
  const blob = await fs.readFile(abs);
  const filename = path.basename(rel, ENC_EXT);

  if (!rel.endsWith(ENC_EXT)) return { buffer: blob, filename };
  try {
    return { buffer: decryptBuffer(blob), filename };
  } catch {
    // wrong key or a plaintext file that happens to carry the .enc name
    return { buffer: blob, filename };
  }
}

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
    const name = `${randomUUID()}${path.extname(file.originalname) || '.jpg'}${ENC_EXT}`;
    await fs.writeFile(path.join(LOCAL_DIR, folder, name), encryptBuffer(file.buffer));
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
