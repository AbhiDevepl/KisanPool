import type {
  ApiResponse,
  BackhaulBookingDTO,
  BackhaulMatchDTO,
  BackhaulRequestDTO,
  BookingOperatorMode,
  CargoCategory,
  CargoRule,
  ChatMessageDTO,
  DemandClusterDTO,
  DocumentDTO,
  FarmMachineDTO,
  GeoPoint,
  GroupingAssessmentDTO,
  Language,
  MachineBookingDTO,
  MachineBookingState,
  MachineCategory,
  MachineQuoteDTO,
  OfferState,
  OperatorMode,
  PricingUnit,
  PaymentDTO,
  PricingEventDTO,
  RatingDTO,
  RiskAssessment,
  RiskLevel,
  DemandAssessment,
  DemandLevel,
  TripPredictionDTO,
  TripPredictionEvent,
  Role,
  ShipmentShareDTO,
  ShipmentState,
  TransporterOfferDTO,
  TransportRequestDTO,
  TripCapacity,
  TripPricingDTO,
  TripState,
  TripUtilisationDTO,
  ReturnLegState,
  UserDTO,
  VehicleDTO,
  VehicleStatus,
  VehicleType,
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
  RiskAssessment,
  RiskLevel,
  DemandAssessment,
  DemandLevel,
  TripPredictionDTO,
  TripPredictionEvent,
  // V2
  BackhaulBookingDTO,
  BackhaulMatchDTO,
  BackhaulRequestDTO,
  BookingOperatorMode,
  CargoCategory,
  CargoRule,
  DemandClusterDTO,
  FarmMachineDTO,
  GroupingAssessmentDTO,
  MachineBookingDTO,
  MachineBookingState,
  MachineCategory,
  MachineQuoteDTO,
  OperatorMode,
  PricingUnit,
  ReturnLegState,
  TripUtilisationDTO,
};

/** A machine as discovery returns it — the stored record plus this job's numbers. */
export interface MachineSearchResult extends FarmMachineDTO {
  distanceKm: number;
  availableForWindow: boolean;
  completedJobs: number;
  /** priced for the window and area the farmer searched with; null if they gave none */
  quote: MachineQuoteDTO | null;
}

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
  } catch {
    throw new AppError(
      'EXTERNAL_SERVICE_ERROR',
      'We could not reach KisanPool. Please check your connection.',
    );
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new AppError('EXTERNAL_SERVICE_ERROR', 'Something went wrong. Please try again.');
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

  /**
   * Live Track hand-off (ADR-042): the transporter's latest position + the
   * destination mandi + a ready Google Maps directions link, and one
   * business-state `trackable` flag. Refetched on trip:location.
   */
  trackTrip: (tripId: string) =>
    request<{
      tripId: string;
      tripState: TripState;
      trackable: boolean;
      reason?: string;
      origin: { lat: number; lng: number } | null;
      destination: { name: string; lat: number; lng: number };
      lastSeenAt: string | null;
      stale: boolean;
      staleMinutes: number | null;
      directionsUrl: string | null;
    }>(`/pool/trips/${tripId}/track`),

  /**
   * Advisory delay / cancellation risk for one trip (ADR-041). Read-only — it
   * never changes the trip. A farmer gets `delay` only; the transporter also
   * gets `cancellation`.
   */
  tripPrediction: (tripId: string) =>
    request<TripPredictionDTO>(`/predictions/trips/${tripId}`),

  /** High-demand corridors — useful when a driver is choosing where to head. */
  demandPredictions: () => request<DemandAssessment[]>('/predictions/demand'),

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

  payoutOnboarding: (input: { panNumber: string; bankAccountNumber: string; ifsc: string }) =>
    request<{ payoutStatus: string }>('/transporters/payout-onboarding', {
      method: 'POST',
      body: input,
    }),

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
      account: { payoutStatus: string } | null;
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

  /** Resolve a typed place name to coordinates (village / town / landmark). */
  searchPlaces: (q: string, near?: { lat: number; lng: number } | null) =>
    request<Array<{ name: string; lat: number; lng: number; source: 'google' | 'local' }>>(
      `/maps/places?q=${encodeURIComponent(q)}${near ? `&near=${near.lat},${near.lng}` : ''}`,
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

  // ==========================================================================
  // V2 · Farm Resource Network
  // ==========================================================================

  /** Machines that could actually do THIS job — priced for the window and area. */
  findMachines: (query: {
    lat: number;
    lng: number;
    category?: MachineCategory;
    start?: string;
    end?: string;
    operatorMode?: BookingOperatorMode;
    areaAcres?: number;
  }) => {
    const params = new URLSearchParams({ lat: String(query.lat), lng: String(query.lng) });
    if (query.category) params.set('category', query.category);
    if (query.start) params.set('start', query.start);
    if (query.end) params.set('end', query.end);
    if (query.operatorMode) params.set('operatorMode', query.operatorMode);
    if (query.areaAcres) params.set('areaAcres', String(query.areaAcres));
    return request<MachineSearchResult[]>(`/farm/machines?${params.toString()}`);
  },

  getMachine: (id: string) =>
    request<
      FarmMachineDTO & {
        completedJobs: number;
        schedule: {
          busy: Array<{ bookingId: string; start: string; end: string; state: string }>;
          blackouts: Array<{ start: string; end: string; reason?: string }>;
        };
      }
    >(`/farm/machines/${id}`),

  /** Nearby farmers wanting the same machine the same week. */
  machineDemand: (lat: number, lng: number, radiusKm = 40) =>
    request<DemandClusterDTO[]>(`/farm/demand?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`),

  /**
   * Could this hire share a provider outing — and its travel cost — with jobs
   * already booked nearby (ADR-042)? Advisory, read-only.
   */
  machineGrouping: (
    machineId: string,
    q: { lat: number; lng: number; start: string; end: string; areaAcres?: number },
  ) =>
    request<GroupingAssessmentDTO>(
      `/farm/machines/${machineId}/grouping?lat=${q.lat}&lng=${q.lng}&start=${encodeURIComponent(
        q.start,
      )}&end=${encodeURIComponent(q.end)}${q.areaAcres ? `&areaAcres=${q.areaAcres}` : ''}`,
    ),

  /** Provider action: group not-yet-started bookings so their travel is shared. */
  groupMachineBookings: (bookingIds: string[]) =>
    request<{ groupId: string; shareCount: number; bookings: MachineBookingDTO[] }>(
      '/farm/bookings/group',
      { method: 'POST', body: { bookingIds } },
    ),

  // ---- the provider's side; any user may own a machine ----

  myMachines: () =>
    request<Array<FarmMachineDTO & { completedJobs: number; upcoming: number }>>(
      '/farm/machines/mine',
    ),

  listMachine: (machine: {
    category: MachineCategory;
    title: string;
    makeModel?: string;
    operatorMode: OperatorMode;
    attachments?: string[];
    baseLocation: GeoPoint;
    serviceRadiusKm: number;
    pricing: {
      unit: PricingUnit;
      rate: number;
      minimumCharge: number;
      travelRatePerKm: number;
    };
  }) => request<FarmMachineDTO>('/farm/machines', { method: 'POST', body: machine }),

  updateMachine: (id: string, updates: Record<string, unknown>) =>
    request<FarmMachineDTO>(`/farm/machines/${id}`, { method: 'PATCH', body: updates }),

  addBlackout: (id: string, blackout: { start: string; end: string; reason?: string }) =>
    request<FarmMachineDTO>(`/farm/machines/${id}/blackouts`, { method: 'POST', body: blackout }),

  // ---- bookings, both sides ----

  bookMachine: (input: {
    machineId: string;
    start: string;
    end: string;
    location: GeoPoint;
    operatorMode: BookingOperatorMode;
    workType?: string;
    areaAcres?: number;
    notes?: string;
  }) => request<MachineBookingDTO>('/farm/bookings', { method: 'POST', body: input }),

  /** `role` picks the side: what I hired, or what I was asked to provide. */
  machineBookings: (role: 'farmer' | 'provider' = 'farmer') =>
    request<MachineBookingDTO[]>(`/farm/bookings/mine?role=${role}`),

  setMachineBookingState: (id: string, state: MachineBookingState, extra?: { otp?: string; reason?: string }) =>
    request<MachineBookingDTO>(`/farm/bookings/${id}/state`, {
      method: 'PATCH',
      body: { state, ...extra },
    }),

  machineEarnings: () =>
    request<{
      jobs: Array<{
        bookingId: string;
        machineId: string;
        machineTitle: string;
        category: MachineCategory;
        completedAt?: string;
        amount: number;
        earning: number;
        paid: boolean;
      }>;
      total: number;
      settled: number;
      machineCount: number;
    }>('/farm/earnings'),

  // ==========================================================================
  // V2 · Backhaul Network
  // ==========================================================================

  /** What may be carried on what — configuration the server enforces. */
  cargoCategories: () =>
    request<Array<CargoRule & { key: CargoCategory }>>('/backhaul/cargo-categories'),

  postReturnLoad: (input: {
    cargoCategory: CargoCategory;
    description: string;
    weightKg: number;
    pickup: GeoPoint;
    destination: GeoPoint;
    readyFrom: string;
    readyUntil: string;
    offeredPrice?: number;
    notes?: string;
  }) => request<BackhaulRequestDTO>('/backhaul/requests', { method: 'POST', body: input }),

  myReturnLoads: () =>
    request<
      Array<
        BackhaulRequestDTO & {
          booking: {
            _id: string;
            tripId: string;
            state: string;
            price: number;
            pickupOtp: string;
            transporter: { _id: string; name: string; phone?: string; ratingAvg: number } | null;
          } | null;
        }
      >
    >('/backhaul/requests/mine'),

  cancelReturnLoad: (id: string) =>
    request<{ request: BackhaulRequestDTO }>(`/backhaul/requests/${id}/cancel`, {
      method: 'POST',
      body: {},
    }),

  // ---- the driver's side ----

  openReturnLeg: (tripId: string) =>
    request<{ trip: TripSummary; capacity: { totalKg: number; bookedKg: number; availableKg: number } }>(
      `/backhaul/trips/${tripId}/return-leg/open`,
      { method: 'POST', body: {} },
    ),

  returnLoads: (tripId: string) =>
    request<{
      open: boolean;
      capacity: { totalKg: number; bookedKg: number; availableKg: number } | null;
      leg: {
        from: GeoPoint;
        to: GeoPoint;
        emptyReturnKm: number;
        state: ReturnLegState;
      } | null;
      matches: BackhaulMatchDTO[];
    }>(`/backhaul/trips/${tripId}/return-loads`),

  acceptReturnLoad: (tripId: string, requestId: string) =>
    request<{
      booking: BackhaulBookingDTO;
      quote: {
        detourKm: number;
        carryKm: number;
        detourCost: number;
        carriageCost: number;
        price: number;
        transporterEarning: number;
        platformFee: number;
        addedMinutes: number;
        utilisationPct: number;
        emptyKmRecovered: number;
      };
      capacity: { totalKg: number; bookedKg: number; availableKg: number };
    }>(`/backhaul/trips/${tripId}/return-loads/${requestId}/accept`, { method: 'POST', body: {} }),

  returnLeg: (tripId: string) =>
    request<{
      returnLeg: {
        state: ReturnLegState;
        origin?: GeoPoint;
        emptyReturnKm: number;
        routeKm: number;
      } | null;
      capacity: { totalKg: number; bookedKg: number; availableKg: number };
      utilisation: TripUtilisationDTO | null;
      bookings: BackhaulBookingDTO[];
    }>(`/backhaul/trips/${tripId}/return-leg`),

  setReturnLoadState: (bookingId: string, state: string, otp?: string) =>
    request<{ booking: BackhaulBookingDTO; utilisation: TripUtilisationDTO | null }>(
      `/backhaul/bookings/${bookingId}/state`,
      { method: 'PATCH', body: { state, otp } },
    ),

  setReturnLegState: (tripId: string, state: ReturnLegState) =>
    request<{ trip: TripSummary; utilisation: TripUtilisationDTO | null }>(
      `/backhaul/trips/${tripId}/return-leg/state`,
      { method: 'PATCH', body: { state } },
    ),
};

export { BASE_URL };
