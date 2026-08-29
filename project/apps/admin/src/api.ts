import type { ApiResponse, ErrorCode, ShipmentState, TripCapacity, TripState } from '@kisanpool/shared';
import { ERROR_STRATEGY } from '@kisanpool/shared';

/**
 * Same envelope and the same 25 error codes as the mobile apps (ADR-018) — the
 * console does not get its own error vocabulary.
 */
export class AdminError extends Error {
  readonly code: ErrorCode;
  readonly strategy: string;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.strategy = ERROR_STRATEGY[code];
  }
}

const TOKEN_KEY = 'kp.admin.token';

/**
 * Empty by default so requests are same-origin and vite.config.ts's `/admin`
 * proxy handles them — no API host baked into the bundle. Set VITE_API_URL only
 * when the console is served from somewhere the API is not.
 */
const base_url = import.meta.env.VITE_API_URL ?? '';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;

  try {
    res = await fetch(base_url + path, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new AdminError('EXTERNAL_SERVICE_ERROR', 'Cannot reach the API. Is the server running?');
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (json.success) return json.data;

  if (json.error.code === 'AUTH_UNAUTHENTICATED' && token) clearToken();
  throw new AdminError(json.error.code, json.error.message);
}

// ---- types the console renders ----

export interface Stats {
  users: { total: number; byRole: Record<string, number>; newThisWeek: number };
  vehicles: {
    total: number;
    byStatus: Record<string, number>;
    byVerification: Record<string, number>;
    capacityTotalKg: number;
    capacityInUseKg: number;
    utilisationPct: number;
  };
  requests: {
    total: number;
    byState: Record<string, number>;
    open: number;
    cancelled: number;
  };
  trips: {
    total: number;
    byState: Record<string, number>;
    active: number;
    completed: number;
    /** farmers per trip — the one number that says whether pooling is happening */
    avgPoolSize: number;
    tonnesMoved: number;
  };
  pooling: { shipments: number; totalSaved: number; offersOpen: number };
  money: {
    collected: number;
    paidOut: number;
    refunded: number;
    byStatus: Record<string, number>;
  };
  trust: { ratings: number; avgStars: number; documentsPending: number };
}

export interface AdminUser {
  _id: string;
  name: string;
  phone: string;
  role: 'FARMER' | 'TRANSPORTER';
  language: string;
  location: string | null;
  ratingAvg: number;
  ratingCount: number;
  phoneVerifiedAt: string | null;
  createdAt: string;
  hasPushToken: boolean;
  vehicle: {
    _id: string;
    registrationNumber: string;
    verificationStatus: string;
    status: string;
  } | null;
  /** requests this farmer has put into the pool, and how many found a transporter */
  requestCount: number;
  confirmedCount: number;
}

export interface KycGroup {
  user: { _id: string; name: string; phone: string; role: string };
  vehicle: {
    _id: string;
    registrationNumber: string;
    vehicleType: string;
    capacityKg: number;
    verificationStatus: string;
  } | null;
  documents: Array<{
    _id: string;
    type: string;
    fileUrl: string;
    status: string;
    reviewedAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
  }>;
}

export interface AdminVehicle {
  _id: string;
  registrationNumber: string;
  vehicleType: string;
  status: string;
  verificationStatus: string;
  capacityKg: number;
  availableCapacityKg: number;
  ratePerKm: number;
  currentLocation: { lat: number; lng: number } | null;
  updatedAt: string;
  owner: { name: string; phone: string; ratingAvg: number } | null;
  activeTrip: {
    _id: string;
    state: TripState;
    to: string;
    startedAt: string | null;
    /** derived from the shipments aboard, never a stored counter */
    capacity: TripCapacity | null;
    poolSize: number;
  } | null;
}

export interface Person {
  _id: string;
  name: string;
  phone: string;
  ratingAvg: number;
}

export interface LiveShipment {
  _id: string;
  state: ShipmentState;
  cropType: string;
  quantityKg: number;
  pickup: { name: string; lat: number; lng: number };
  pickupSequence: number;
  allocatedPrice: number;
  finalPrice: number | null;
  soloPrice: number;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  farmer: Person | null;
}

export interface LiveTrip {
  _id: string;
  state: TripState;
  destination: { name: string; lat: number; lng: number };
  routeDistanceKm: number;
  estimatedRouteCost: number;
  pricingVersion: number;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  minutesInState: number;
  stuck: boolean;
  transporter: Person | null;
  vehicle: {
    _id: string;
    registrationNumber: string;
    vehicleType: string;
    status: string;
    capacityKg: number;
    currentLocation: { lat: number; lng: number } | null;
  } | null;
  capacity: TripCapacity;
  poolSize: number;
  pickedUpCount: number;
  deliveredCount: number;
  shipments: LiveShipment[];
}

export interface LiveOps {
  generatedAt: string;
  stuckMinutes: number;
  trips: LiveTrip[];
  alerts: {
    stuckTrips: Array<{
      _id: string;
      state: TripState;
      minutesInState: number;
      transporter: string;
      to: string;
      poolSize: number;
    }>;
    idleVehicles: Array<{
      _id: string;
      registrationNumber: string;
      status: string;
      verificationStatus: string;
      capacityKg: number;
      owner: string;
      minutesIdle: number;
    }>;
    unclaimedRequests: Array<{
      _id: string;
      farmer: string;
      cropType: string;
      quantityKg: number;
      from: string;
      to: string;
      preferredDate: string;
      minutesOpen: number;
    }>;
  };
}

export interface Settlement {
  shipmentId: string;
  tripId: string;
  requestId: string;
  farmer: { _id: string; name: string; phone: string } | null;
  cropType: string;
  quantityKg: number;
  shipmentState: ShipmentState;
  allocatedPrice: number;
  finalPrice: number | null;
  soloPrice: number;
  saved: number;
  deliveredAt: string | null;
  trip: BillingTrip | null;
  payment: {
    _id: string;
    amount: number;
    status: string;
    platformFee: number;
    transporterPayoutAmount: number;
    transferId: string | null;
    transferStatus: string | null;
    razorpayOrderId: string | null;
    capturedAt: string | null;
    createdAt: string;
  } | null;
}

export interface BillingTrip {
  _id: string;
  state: TripState;
  to: string;
  pricingVersion: number;
}

export interface Billing {
  settlements: Settlement[];
  totals: {
    billed: number;
    collected: number;
    awaitingPayment: number;
    paidOut: number;
    awaitingTransfer: number;
    totalSaved: number;
  };
  trips: BillingTrip[];
}

export interface PricingAudit {
  trip: {
    _id: string;
    state: TripState;
    to: string;
    routeDistanceKm: number;
    estimatedRouteCost: number;
    pricingVersion: number;
    transporter: { name: string; phone: string } | null;
    poolSize: number;
  };
  events: Array<{
    _id: string;
    version: number;
    reason: string;
    routeDistanceKm: number;
    routeCost: number;
    totalQuantityKg: number;
    createdAt: string;
    allocations: Array<{
      shipmentId: string;
      farmerId: string;
      farmerName: string;
      quantityKg: number;
      amount: number;
      previousAmount: number | null;
      delta: number | null;
    }>;
  }>;
}


// ---- bookings / mandis / AI ----

export interface AdminRequestRow {
  _id: string;
  state: string;
  cropType: string;
  quantityKg: number;
  from: string;
  to: string;
  preferredDate: string;
  createdAt: string;
  minutesOpen: number;
  farmer: { _id: string; name: string; phone: string } | null;
  /** transporters who ACCEPTED — reserves nothing */
  offerCount: number;
  totalOffers: number;
  /** present only once the farmer CONFIRMED one of them */
  shipment: {
    _id: string;
    tripId: string;
    state: ShipmentState;
    price: number;
    soloPrice: number;
  } | null;
}

export interface AdminBookings {
  requests: AdminRequestRow[];
  totals: {
    total: number;
    open: number;
    awaitingFarmer: number;
    confirmed: number;
    cancelled: number;
  };
}

export interface AdminMandi {
  _id: string;
  name: string;
  city: string;
  state: string;
  crops: string[];
  active: boolean;
  location: { name: string; lat: number; lng: number };
  createdAt: string;
}

export interface NewMandi {
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  crops?: string[];
}

export interface AiActivity {
  totals: { sessions: number; turns: number; awaitingConfirmation: number; avgTurns: number };
  byLanguage: Record<string, number>;
  recent: Array<{
    _id: string;
    user: { name: string; role: string } | null;
    language: string;
    turns: number;
    lastMessage: string | null;
    lastRole: string | null;
    pending: string | null;
    updatedAt: string;
  }>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; usingDefaultCredentials: boolean }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  stats: () => request<Stats>('/admin/stats'),

  users: (query: { q?: string; role?: string }) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.role) params.set('role', query.role);
    return request<AdminUser[]>(`/admin/users?${params.toString()}`);
  },

  documents: (status?: string) =>
    request<KycGroup[]>(`/admin/documents${status ? `?status=${status}` : ''}`),

  reviewDocument: (id: string, status: 'VERIFIED' | 'REJECTED', reason?: string) =>
    request<{ document: unknown; vehicleVerification: string | null }>(`/admin/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    }),

  vehicles: () => request<AdminVehicle[]>('/admin/vehicles'),

  updateVehicle: (
    id: string,
    patch: {
      status?: string;
      verificationStatus?: string;
      currentLocation?: { lat: number; lng: number };
    },
  ) => request<AdminVehicle>(`/admin/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  live: (stuckMinutes?: number) =>
    request<LiveOps>(`/admin/live${stuckMinutes ? `?stuckMinutes=${stuckMinutes}` : ''}`),

  billing: (query: { status?: string; tripId?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.tripId) params.set('tripId', query.tripId);
    return request<Billing>(`/admin/billing?${params.toString()}`);
  },

  pricingAudit: (tripId: string) => request<PricingAudit>(`/admin/trips/${tripId}/pricing`),

  bookings: (query: { state?: string; q?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.state) params.set('state', query.state);
    if (query.q) params.set('q', query.q);
    return request<AdminBookings>(`/admin/requests?${params.toString()}`);
  },

  mandis: () =>
    request<{ mandis: AdminMandi[] }>('/admin/mandis').then((r) => r.mandis),

  createMandis: (mandis: NewMandi[]) =>
    request<{ mandis: AdminMandi[] }>('/admin/mandis', {
      method: 'POST',
      body: JSON.stringify({ mandis }),
    }).then((r) => r.mandis),

  setMandiActive: (id: string, active: boolean) =>
    request<AdminMandi>(`/admin/mandis/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),

  deleteMandi: (id: string) =>
    request<{ deleted: boolean }>(`/admin/mandis/${id}`, { method: 'DELETE' }),

  ai: () => request<AiActivity>('/admin/ai'),
};
