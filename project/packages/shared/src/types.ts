/**
 * KisanPool — shared domain types and enums.
 * Mirrors docs/DATA_MODEL.md. Imported by both the server and the mobile app.
 */
import type { RequestState } from './pooling';

// ---------- enums ----------

export const ROLES = ['FARMER', 'TRANSPORTER'] as const;
export type Role = (typeof ROLES)[number];

export const LANGUAGES = ['mr', 'hi', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const VEHICLE_TYPES = [
  'PICKUP',
  'TRUCK',
  'TEMPO',
  'TRACTOR',
  'MINI_TRUCK',
  'OTHER',
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ['AVAILABLE', 'BUSY', 'OFFLINE'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DOCUMENT_TYPES = ['RC', 'DL', 'AADHAAR', 'PAN'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const PAYMENT_STATUSES = [
  'CREATED',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYOUT_STATUSES = ['NOT_ONBOARDED', 'PENDING', 'ACTIVE'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Internal transporter wallet — an earnings balance they withdraw to a UPI ID. */
export const WITHDRAWAL_STATUSES = ['PENDING', 'SUCCESS', 'FAILED'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const WALLET_TXN_TYPES = ['CREDIT', 'DEBIT'] as const;
export type WalletTxnType = (typeof WALLET_TXN_TYPES)[number];

export const WALLET_TXN_REASONS = [
  'EARNING',
  'WITHDRAWAL',
  'WITHDRAWAL_REVERSAL',
] as const;
export type WalletTxnReason = (typeof WALLET_TXN_REASONS)[number];

// ---------- value objects ----------

export interface GeoPoint {
  name: string;
  lat: number;
  lng: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

// ---------- documents as the API returns them ----------

export interface UserDTO {
  _id: string;
  name: string;
  phone: string;
  role: Role;
  language: Language;
  defaultLocation?: GeoPoint;
  ratingAvg: number;
  ratingCount: number;
  phoneVerifiedAt?: string;
  createdAt: string;
}

export interface VehicleDTO {
  _id: string;
  ownerId: string;
  vehicleType: VehicleType;
  capacityKg: number;
  availableCapacityKg: number;
  currentLocation?: LatLng;
  ratePerKm: number;
  status: VehicleStatus;
  verificationStatus: VerificationStatus;
  registrationNumber?: string;
}

export interface DocumentDTO {
  _id: string;
  userId: string;
  type: DocumentType;
  fileUrl: string;
  status: VerificationStatus;
  reviewedAt?: string;
  /** set when an operator rejects it — the driver needs to read this to fix it */
  rejectionReason?: string;
  createdAt: string;
}

export interface TransportRequestDTO {
  _id: string;
  farmerId: string;
  cropType: string;
  quantityKg: number;
  pickup: GeoPoint;
  destination: GeoPoint;
  preferredDate: string;
  /** free-text extras the farmer typed — crates, fragile, help loading */
  notes?: string;
  /**
   * The REQUEST's own lifecycle only. Once a transporter is selected the produce's
   * story continues on the shipment — see RequestState in ./pooling.
   */
  state: RequestState;
  /** set when the farmer selects a transporter */
  tripId?: string;
  expiresAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
}

/** An APMC market an operator has placed on the map (ADR-039). */
export interface MandiDTO {
  _id: string;
  name: string;
  city: string;
  state: string;
  location: GeoPoint;
  crops: string[];
  active: boolean;
  createdAt: string;
  /** present only on the farmer's nearby list */
  distanceKm?: number;
  /** road-time estimate to the mandi, minutes (nearby list only) */
  etaMinutes?: number;
}

export interface WalletTransactionDTO {
  _id: string;
  userId: string;
  type: WalletTxnType;
  reason: WalletTxnReason;
  amount: number;
  balanceAfter: number;
  paymentId?: string;
  withdrawalId?: string;
  createdAt: string;
}

export interface WalletDTO {
  balance: number;
  currency: 'INR';
  transactions: WalletTransactionDTO[];
}

export interface WithdrawalDTO {
  _id: string;
  userId: string;
  amount: number;
  upiId: string;
  status: WithdrawalStatus;
  razorpayPayoutId?: string;
  failureReason?: string;
  requestedAt: string;
  processedAt?: string;
}

export interface PaymentDTO {
  _id: string;
  requestId: string;
  farmerId: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  amount: number;
  currency: 'INR';
  status: PaymentStatus;
  platformFee: number;
  transporterPayoutAmount: number;
  transferId?: string;
  refundId?: string;
  refundAmount?: number;
  createdAt: string;
}

export interface RatingDTO {
  _id: string;
  tripId: string;
  /** ratings hang off one farmer's load, since a driver rates several per trip */
  shipmentId: string;
  fromUserId: string;
  toUserId: string;
  stars: number;
  comment?: string;
  createdAt: string;
}

export interface ChatMessageDTO {
  _id: string;
  tripId: string;
  senderId: string;
  text: string;
  createdAt: string;
}

// ---------- socket event payloads (docs/API_CONTRACTS.md §3) ----------

export interface JoinRequestPayload {
  requestId: string;
}
export interface JoinTripPayload {
  tripId: string;
}
export interface VehicleLocationPayload {
  tripId: string;
  lat: number;
  lng: number;
}
export interface ChatSendPayload {
  tripId: string;
  text: string;
}

export interface TripStatusEvent {
  tripId: string;
  status: string;
  at: string;
}
export interface TripLocationEvent {
  tripId: string;
  lat: number;
  lng: number;
  etaMinutes?: number;
}
export interface PaymentCapturedEvent {
  requestId: string;
  paymentId: string;
}
export interface ChatMessageEvent {
  tripId: string;
  senderId: string;
  text: string;
  ts: string;
}

// ---------- AI ----------

export const AI_TOOLS = [
  'getUserProfile',
  'findMatchingVehicles',
  'createTransportRequest',
  'acceptMatch',
  'getTripStatus',
  'cancelRequest',
  'findNearbyMandis',
  'findNearbyTransporters',
] as const;
export type AiTool = (typeof AI_TOOLS)[number];

/** A geo point the chat can drop on a map card. */
export interface AiMapPoint {
  label: string;
  lat: number;
  lng: number;
  /** free line under the label — distance, price, capacity */
  detail?: string;
  kind?: 'mandi' | 'transporter' | 'me';
}

/**
 * A rich block the chat renders under the assistant's text reply — a list of
 * places, or a small map. The model never builds these; they come from a tool
 * result the server shaped.
 */
export type AiCard =
  | { type: 'mandiList'; title: string; items: AiMapPoint[] }
  | { type: 'transporterList'; title: string; items: AiMapPoint[] }
  | { type: 'map'; title: string; center: AiMapPoint; points: AiMapPoint[] };

export interface AiChatResponse {
  reply: string;
  language: Language;
  /** a navigation instruction for the app, never an action the model performed itself */
  action?: {
    type: 'NAVIGATE';
    route: string;
  };
  data?: unknown;
  /** rich blocks to render inline in the chat, in order */
  cards?: AiCard[];
  /** set when the assistant is waiting on a spoken yes before a state-changing tool */
  pendingConfirmation?: {
    tool: AiTool;
    summary: string;
  };
}

// Pricing now lives in ./pooling — a route cost shared by weight, not a fixed
// 60/40 split per request (ADR-031).
