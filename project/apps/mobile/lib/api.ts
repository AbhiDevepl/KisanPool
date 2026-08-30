import type {
  ApiResponse,
  ChatMessageDTO,
  DocumentDTO,
  GeoPoint,
  Language,
  OfferState,
  PaymentDTO,
  PricingEventDTO,
  RatingDTO,
  Role,
  ShipmentShareDTO,
  ShipmentState,
  TransporterOfferDTO,
  TransportRequestDTO,
  TripCapacity,
  TripPricingDTO,
  TripState,
  MandiDTO,
  UserDTO,
  VehicleDTO,
  VehicleStatus,
  VehicleType,
  WalletDTO,
  WithdrawalDTO,
} from '@kisanpool/shared';
import { AppError } from './errors';
import { API_URL as BASE_URL } from './config';
import { clearSession, getAccessToken, getRefreshToken, setTokens } from './session';

// ---- shapes the pooling screens render ----

export interface TripSummary {
  _id: string;
  transporterId: string;
  vehicleId: string;
  destination: GeoPoint;
  state: TripState;
  totalCapacityKg: number;
  routeDistanceKm: number;
  estimatedRouteCost: number;
  pricingVersion: number;
  startedAt?: string;
  completedAt?: string;
}

export interface FarmerShipment {
  _id: string;
  tripId: string;
  requestId: string;
  farmerId: string;
  quantityKg: number;
  cropType: string;
  pickup: GeoPoint;
  pickupSequence: number;
  state: ShipmentState;
  allocatedPrice: number;
  finalPrice?: number;
  soloPrice: number;
  pickupOtp?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
}

export interface TripShipmentView extends FarmerShipment {
  savingPct?: number;
  /** the working behind this load's bill — ride km, detour, tonne-km, both parts */
  pricing?: ShipmentShareDTO | null;
  farmer?: { _id: string; name: string; phone?: string; ratingAvg: number };
}

/** One row in the transporter's pool. */
export interface PoolEntry {
  request: TransportRequestDTO;
  /** name of the farmer who posted this load, for the pickup card */
  farmerName: string | null;
  pickupDistanceKm: number;
  detourKm: number;
  distanceKm: number;
  etaMinutes: number;
  soloPrice: number;
  quotedPrice: number;
  /** what taking this load ADDS to the driver's earning, after the platform cut */
  transporterEarning: number;
  /** and what the whole trip would then be worth to them */
  tripEarningAfter: number;
  utilisationPct: number;
  fitScore: number;
}

export type {
  OfferState,
  ShipmentState,
  ShipmentShareDTO,
  TripState,
  TransporterOfferDTO,
  TripCapacity,
  TripPricingDTO,
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  /** internal: prevents an endless refresh loop */
  retriedAfterRefresh?: boolean;
}

/**
 * The only way the app talks to the backend. Throws AppError whenever the
 * envelope says success:false — callers only ever handle data (ADR-015).
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';

  if (auth) {
    const token = await getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
  } catch (err) {
    console.warn(`[api] ${method} ${BASE_URL}${path} — network error:`, err);
    throw new AppError(
      'EXTERNAL_SERVICE_ERROR',
      `Could not reach the server at ${BASE_URL} (${(err as Error)?.message ?? 'network error'}).`,
    );
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch (err) {
    console.warn(`[api] ${method} ${path} — HTTP ${res.status}, non-JSON body:`, err);
    throw new AppError('EXTERNAL_SERVICE_ERROR', `Server returned HTTP ${res.status}.`);
  }

  if (!json.success) {
    console.log(json.error);
    
    console.warn(`[api] ${method} ${path} — ${json.error.code}: ${json.error.message}`);
  }

  if (json.success) return json.data;

  // AUTH_UNAUTHENTICATED: one silent refresh, then the caller redirects to sign-in
  if (json.error.code === 'AUTH_UNAUTHENTICATED' && auth && !options.retriedAfterRefresh) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...options, retriedAfterRefresh: true });
    await clearSession();
  }

  throw new AppError(json.error.code, json.error.message);
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const json = (await res.json()) as ApiResponse<{
      accessToken: string;
      refreshToken: string;
    }>;
    if (!json.success) return false;
    await setTokens(json.data.accessToken, json.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ---------- auth ----------

export const api = {
  requestOtp: (phone: string, role: Role) =>
    request<{ sent: true; devCode?: string }>('/auth/request-otp', {
      method: 'POST',
      body: { phone, role },
      auth: false,
    }),

  verifyOtp: (phone: string, code: string) =>
    request<{ accessToken: string; refreshToken: string; user: UserDTO }>('/auth/verify-otp', {
      method: 'POST',
      body: { phone, code },
      auth: false,
    }),

  // ---------- users ----------

  me: () => request<UserDTO>('/users/me'),

  updateMe: (updates: {
    name?: string;
    language?: Language;
    pushToken?: string;
    defaultLocation?: GeoPoint;
  }) => request<UserDTO>('/users/me', { method: 'PATCH', body: updates }),

  // ---------- vehicles ----------

  registerVehicle: (vehicle: {
    vehicleType: VehicleType;
    registrationNumber: string;
    capacityKg: number;
    ratePerKm: number;
    currentLocation?: { lat: number; lng: number };
  }) => request<VehicleDTO>('/vehicles', { method: 'POST', body: vehicle }),

  myVehicle: () => request<VehicleDTO | null>('/vehicles/me'),

  setAvailability: (vehicleId: string, status: VehicleStatus) =>
    request<VehicleDTO>(`/vehicles/${vehicleId}/availability`, {
      method: 'PATCH',
      body: { status },
    }),

  updateVehicleLocation: (loc: { lat: number; lng: number }) =>
    request<VehicleDTO>('/vehicles/me/location', { method: 'PATCH', body: loc }),

  // ---------- documents / KYC ----------

  uploadDocument: (type: string, file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file as unknown as Blob);
    return request<DocumentDTO>('/documents', { method: 'POST', form });
  },

  myDocuments: () =>
    request<{
      documents: DocumentDTO[];
      kyc: {
        submitted: boolean;
        documents: Record<string, string>;
        verified: boolean;
        rejected: boolean;
        panSubmitted: boolean;
      };
    }>('/documents/me'),

  // ---------- transport: the farmer's request ----------

  createRequest: (input: {
    cropType: string;
    quantityKg: number;
    pickup: GeoPoint;
    destination: GeoPoint;
    preferredDate: string;
    notes?: string;
  }) => request<TransportRequestDTO>('/transport/requests', { method: 'POST', body: input }),

  /** The farmer's requests, each with how many transporters have claimed it. */
  myRequests: () =>
    request<
      Array<
        TransportRequestDTO & {
          offerCount: number;
          shipment: {
            _id: string;
            tripId: string;
            state: ShipmentState;
            allocatedPrice: number;
            finalPrice: number | null;
            soloPrice: number;
            pickupOtp: string;
          } | null;
        }
      >
    >('/transport/requests'),

  getRequest: (id: string) =>
    request<{
      request: TransportRequestDTO;
      shipment: FarmerShipment | null;
      trip: TripSummary | null;
    }>(`/transport/requests/${id}`),

  cancelRequest: (id: string, reason: string) =>
    request<{ request: TransportRequestDTO }>(`/transport/requests/${id}/cancel`, {
      method: 'POST',
      body: { reason },
    }),

  deleteRequest: (id: string) =>
    request<{ deleted: true }>(`/transport/requests/${id}`, { method: 'DELETE' }),

  /** Chat is per shared trip — every farmer aboard plus the driver. */
  messages: (tripId: string) => request<ChatMessageDTO[]>(`/transport/trips/${tripId}/messages`),

  // ---------- pool: transporter side ----------

  /** Requests worth this driver's while, ranked by how well they fit the route. */
  pool: () =>
    request<{
      offline: boolean;
      trip: { trip: TripSummary; capacity: TripCapacity } | null;
      requests: PoolEntry[];
    }>('/pool/requests'),

  claimRequest: (requestId: string, message?: string) =>
    request<TransporterOfferDTO>(`/pool/requests/${requestId}/claim`, {
      method: 'POST',
      body: { message },
    }),

  withdrawOffer: (offerId: string) =>
    request<TransporterOfferDTO>(`/pool/offers/${offerId}/withdraw`, { method: 'POST', body: {} }),

  /** Claims this driver is waiting on a farmer to decide. */
  myOffers: () =>
    request<Array<TransporterOfferDTO & { request: TransportRequestDTO }>>('/pool/offers/mine'),

  // ---------- pool: farmer side ----------

  /** The transporters who claimed this request, cheapest first. */
  offersFor: (requestId: string) =>
    request<TransporterOfferDTO[]>(`/pool/requests/${requestId}/offers`),

  /** The farmer's final choice — this is what reserves capacity. */
  selectTransporter: (requestId: string, offerId: string) =>
    request<{
      trip: TripSummary;
      shipment: FarmerShipment;
      capacity: TripCapacity;
      pricingVersion: number;
      pricing: TripPricingDTO | null;
    }>(`/pool/requests/${requestId}/select`, { method: 'POST', body: { offerId } }),

  // ---------- the shared trip ----------

  getTrip: (tripId: string) =>
    request<{
      trip: TripSummary & { capacity: TripCapacity };
      /** the one authoritative set of numbers — both roles render from this */
      pricing: TripPricingDTO | null;
      vehicle: VehicleDTO | null;
      transporter: { _id: string; name: string; phone?: string; ratingAvg: number } | null;
      shipments: TripShipmentView[];
    }>(`/pool/trips/${tripId}`),

  myTrips: () =>
    request<
      Array<
        TripSummary & {
          capacity: TripCapacity;
          poolSize: number;
          pricing: TripPricingDTO | null;
        }
      >
    >('/pool/trips/mine'),

  setTripState: (tripId: string, state: TripState) =>
    request<TripSummary>(`/pool/trips/${tripId}/state`, { method: 'PATCH', body: { state } }),

  /** Why each farmer's share changed, newest first. */
  pricingHistory: (tripId: string) => request<PricingEventDTO[]>(`/pool/trips/${tripId}/pricing`),

  // ---------- shipments ----------

  setShipmentState: (shipmentId: string, state: ShipmentState, otp?: string) =>
    request<TripShipmentView>(`/pool/shipments/${shipmentId}/state`, {
      method: 'PATCH',
      body: { state, otp },
    }),

  /** The farmer's loads across every trip. */
  myShipments: () =>
    request<Array<TripShipmentView & { savingPct: number; trip: TripSummary | null }>>(
      '/pool/shipments/mine',
    ),

  // ---------- payments (after delivery now) ----------

  createOrder: (shipmentId: string) =>
    request<{
      razorpayOrderId: string;
      amount: number;
      currency: string;
      keyId: string;
      demo: boolean;
    }>('/payments/create-order', { method: 'POST', body: { shipmentId } }),

  verifyPayment: (payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => request<PaymentDTO>('/payments/verify', { method: 'POST', body: payload }),

  myPayments: () =>
    request<
      Array<{
        payment: PaymentDTO;
        shipment: {
          _id: string;
          cropType: string;
          quantityKg: number;
          from: string | null;
          soloPrice: number;
          finalPrice: number;
        } | null;
      }>
    >('/payments/me'),

  payoutOnboarding: (input: { upiId: string }) =>
    request<{ payoutStatus: string; upiId?: string }>('/transporters/payout-onboarding', {
      method: 'POST',
      body: input,
    }),

  // ---------- transporter wallet & withdrawals ----------

  wallet: () => request<WalletDTO>('/wallet/me'),

  withdrawals: () =>
    request<{ withdrawals: WithdrawalDTO[] }>('/wallet/withdrawals'),

  withdraw: (input: { amount: number; upiId: string }) =>
    request<WithdrawalDTO>('/wallet/withdraw', { method: 'POST', body: input }),

  // ---------- mandis (operator-created) ----------

  mandis: (near?: { lat: number; lng: number; radiusKm?: number }) => {
    const q = near
      ? `?lat=${near.lat}&lng=${near.lng}&radiusKm=${near.radiusKm ?? 150}`
      : '';
    return request<{ mandis: MandiDTO[] }>(`/mandis${q}`).then((r) => r.mandis);
  },

  mandi: (id: string) => request<MandiDTO>(`/mandis/${id}`),

  payouts: () =>
    request<{
      payouts: Array<{
        paymentId: string;
        shipmentId: string;
        tripId: string;
        amount: number;
        transferId: string | null;
        transferStatus: string;
        createdAt: string;
        from: string | null;
        to: string | null;
        cropType: string | null;
        quantityKg: number | null;
      }>;
      total: number;
      account: { payoutStatus: string; upiId?: string } | null;
    }>('/transporters/payouts'),

  // ---------- ratings (per shipment) ----------

  rate: (shipmentId: string, stars: number, comment?: string) =>
    request<RatingDTO>(`/shipments/${shipmentId}/ratings`, {
      method: 'POST',
      body: { stars, comment },
    }),

  ratings: (shipmentId: string) => request<RatingDTO[]>(`/shipments/${shipmentId}/ratings`),

  // ---------- maps ----------

  directions: (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) =>
    request<{ distanceKm: number; durationMinutes: number; polyline: string | null }>(
      `/maps/directions?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}`,
    ),

  // ---------- Servo AI ----------

  stt: (audio: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('audio', audio as unknown as Blob);
    return request<{ transcript: string; language: Language }>('/ai/stt', {
      method: 'POST',
      form,
    });
  },

  tts: (text: string, language: Language) =>
    request<{ audio: string }>('/ai/tts', { method: 'POST', body: { text, language } }),

  aiChat: (message: string, sessionId: string, language?: Language) =>
    request<import('@kisanpool/shared').AiChatResponse>('/ai/chat', {
      method: 'POST',
      body: { message, sessionId, language },
    }),
};

export { BASE_URL };
