/**
 * The Farm Resource Network's vocabulary — every label the app is allowed to use.
 *
 * Same job as lib/pooling.ts does for produce transport: the words a farmer reads
 * live in one file, so a state cannot be described one way on the discovery screen
 * and another way in their bookings list.
 *
 * THE RULE THIS FILE ENFORCES
 * ---------------------------
 * A machine REQUESTED is a slot HELD, not a job confirmed. That is the opposite
 * of the transport side, where a transporter's acceptance reserves nothing — and
 * the difference is deliberate, because there is no pool of providers to compare
 * afterwards. The copy has to make that plain to both sides: the farmer must not
 * assume the tractor is coming, and the provider must know the slot is theirs to
 * lose.
 */
import type {
  BackhaulBookingState,
  CargoCategory,
  MachineBookingState,
  MachineCategory,
  OperatorMode,
  PricingUnit,
  ReturnLegState,
} from '@kisanpool/shared';
import { MaterialIcons } from '@expo/vector-icons';

type Icon = keyof typeof MaterialIcons.glyphMap;

export interface StateCopy {
  label: string;
  detail: string;
  badge: string;
}

// ---------------------------------------------------------------------------
// what can be hired
// ---------------------------------------------------------------------------

export const MACHINE_LABEL: Record<MachineCategory, string> = {
  TRACTOR: 'Tractor',
  TRACTOR_TROLLEY: 'Tractor + trolley',
  COMBINE_HARVESTER: 'Combine harvester',
  HARVESTER: 'Harvester',
  ROTAVATOR: 'Rotavator',
  CULTIVATOR: 'Cultivator',
  SEED_DRILL: 'Seed drill',
  THRESHER: 'Thresher',
  SPRAYER: 'Sprayer',
  REAPER: 'Reaper',
  PLOUGH: 'Plough',
  LEVELLER: 'Land leveller',
  WATER_TANKER: 'Water tanker',
  BALER: 'Baler',
  OTHER: 'Other equipment',
};

/** Marathi alongside English, the way the rest of the app speaks to farmers. */
export const MACHINE_NATIVE: Partial<Record<MachineCategory, string>> = {
  TRACTOR: 'ट्रॅक्टर',
  TRACTOR_TROLLEY: 'ट्रॅक्टर + ट्रॉली',
  COMBINE_HARVESTER: 'कंबाईन हार्वेस्टर',
  HARVESTER: 'हार्वेस्टर',
  ROTAVATOR: 'रोटाव्हेटर',
  CULTIVATOR: 'कल्टिव्हेटर',
  SEED_DRILL: 'पेरणी यंत्र',
  THRESHER: 'मळणी यंत्र',
  SPRAYER: 'फवारणी यंत्र',
  REAPER: 'रीपर',
  PLOUGH: 'नांगर',
  LEVELLER: 'सपाटीकरण यंत्र',
  WATER_TANKER: 'पाण्याचा टँकर',
  BALER: 'बेलर',
};

export const MACHINE_ICON: Record<MachineCategory, Icon> = {
  TRACTOR: 'agriculture',
  TRACTOR_TROLLEY: 'agriculture',
  COMBINE_HARVESTER: 'grass',
  HARVESTER: 'grass',
  ROTAVATOR: 'settings',
  CULTIVATOR: 'settings',
  SEED_DRILL: 'grain',
  THRESHER: 'blur-on',
  SPRAYER: 'water-drop',
  REAPER: 'content-cut',
  PLOUGH: 'landscape',
  LEVELLER: 'horizontal-rule',
  WATER_TANKER: 'local-drink',
  BALER: 'inventory-2',
  OTHER: 'build',
};

/** The categories a farmer sees first — the ones actually hired most. */
export const POPULAR_CATEGORIES: MachineCategory[] = [
  'TRACTOR_TROLLEY',
  'COMBINE_HARVESTER',
  'ROTAVATOR',
  'THRESHER',
  'SEED_DRILL',
  'SPRAYER',
];

export const UNIT_LABEL: Record<PricingUnit, string> = {
  PER_HOUR: 'per hour',
  PER_ACRE: 'per acre',
  PER_DAY: 'per day',
  PER_JOB: 'per job',
};

/** What the quote's `billableUnits` is counting, for the price breakdown. */
export const UNIT_NOUN: Record<PricingUnit, (n: number) => string> = {
  PER_HOUR: (n) => `${n} hour${n === 1 ? '' : 's'}`,
  PER_ACRE: (n) => `${n} acre${n === 1 ? '' : 's'}`,
  PER_DAY: (n) => `${n} day${n === 1 ? '' : 's'}`,
  PER_JOB: () => 'the job',
};

export const OPERATOR_LABEL: Record<OperatorMode, string> = {
  SELF_DRIVE: 'You drive it',
  WITH_OPERATOR: 'Comes with an operator',
  EITHER: 'With or without an operator',
};

// ---------------------------------------------------------------------------
// the hire's lifecycle, as each side reads it
// ---------------------------------------------------------------------------

/** What the FARMER who booked it sees. */
export const BOOKING_COPY: Record<MachineBookingState, StateCopy> = {
  REQUESTED: {
    label: 'Waiting for the provider',
    // the slot IS held — say so, or the farmer books three tractors "to be safe"
    detail: 'Your slot is held while the provider answers. Nobody else can take this time.',
    badge: 'PENDING',
  },
  CONFIRMED: {
    label: 'Confirmed',
    detail: 'The provider is coming. Keep your start code ready for when they arrive.',
    badge: 'ASSIGNED',
  },
  IN_PROGRESS: {
    label: 'Work in progress',
    detail: 'The machine is on your field now.',
    badge: 'IN_TRANSIT',
  },
  COMPLETED: {
    label: 'Work finished',
    detail: 'The job is done and the final amount is settled.',
    badge: 'DELIVERED',
  },
  PAID: { label: 'Paid', detail: 'Payment received. Thank you.', badge: 'PAID' },
  CANCELLED: {
    label: 'Cancelled',
    detail: 'You withdrew this booking. Nothing was charged.',
    badge: 'CANCELLED',
  },
  DECLINED: {
    label: 'Provider could not take it',
    detail: 'The slot is free again — try another provider or another time.',
    badge: 'REJECTED',
  },
};

/** What the PROVIDER sees for the same row. Same states, different reading. */
export const PROVIDER_COPY: Record<MachineBookingState, StateCopy> = {
  REQUESTED: {
    label: 'Needs your answer',
    detail: 'This time is held on your machine until you accept or decline it.',
    badge: 'PENDING',
  },
  CONFIRMED: {
    label: 'You accepted',
    detail: 'Booked. Ask the farmer for their start code when you reach the field.',
    badge: 'ASSIGNED',
  },
  IN_PROGRESS: { label: 'Working', detail: 'This job is running now.', badge: 'IN_TRANSIT' },
  COMPLETED: {
    label: 'Finished',
    detail: 'Billed at what the work actually took.',
    badge: 'DELIVERED',
  },
  PAID: { label: 'Paid out', detail: 'Your share has been settled.', badge: 'PAID' },
  CANCELLED: {
    label: 'Farmer cancelled',
    detail: 'The slot is free again on your calendar.',
    badge: 'CANCELLED',
  },
  DECLINED: {
    label: 'You declined',
    detail: 'The slot went back to being free.',
    badge: 'REJECTED',
  },
};

/** States where a booking is still going to happen — what "upcoming" means. */
export const LIVE_BOOKING_STATES: MachineBookingState[] = [
  'REQUESTED',
  'CONFIRMED',
  'IN_PROGRESS',
];

// ---------------------------------------------------------------------------
// the Backhaul Network
// ---------------------------------------------------------------------------

export const CARGO_LABEL: Record<CargoCategory, string> = {
  GENERAL_GOODS: 'General goods',
  GROCERY_RETAIL: 'Grocery & retail stock',
  AGRI_INPUTS: 'Agricultural inputs',
  PACKAGING_MATERIAL: 'Packaging material',
  ANIMAL_FEED: 'Animal feed',
  CONSTRUCTION_MATERIAL: 'Construction material',
  EMPTY_CRATES: 'Empty crates & sacks',
};

export const CARGO_ICON: Record<CargoCategory, Icon> = {
  GENERAL_GOODS: 'inventory-2',
  GROCERY_RETAIL: 'shopping-basket',
  AGRI_INPUTS: 'grass',
  PACKAGING_MATERIAL: 'takeout-dining',
  ANIMAL_FEED: 'pets',
  CONSTRUCTION_MATERIAL: 'foundation',
  EMPTY_CRATES: 'inbox',
};

export const RETURN_LEG_COPY: Record<ReturnLegState, StateCopy> = {
  NONE: {
    label: 'Not started',
    detail: 'The return journey opens once every farmer load is delivered.',
    badge: 'PENDING',
  },
  OPEN: {
    label: 'Looking for return loads',
    detail: 'You are driving back anyway — anything you take now is extra earning.',
    badge: 'SEARCHING',
  },
  LOADING: {
    label: 'Collecting return loads',
    detail: 'Pick up what you accepted, then start for home.',
    badge: 'EN_ROUTE',
  },
  IN_TRANSIT: {
    label: 'On the way home',
    detail: 'Carrying return cargo instead of running empty.',
    badge: 'IN_TRANSIT',
  },
  COMPLETED: {
    label: 'Return complete',
    detail: 'Every return load delivered.',
    badge: 'COMPLETED',
  },
  CANCELLED: { label: 'Return cancelled', detail: 'You drove back empty.', badge: 'CANCELLED' },
};

export const BACKHAUL_COPY: Record<BackhaulBookingState, StateCopy> = {
  BOOKED: {
    label: 'Booked',
    detail: 'Accepted onto your return journey. Collect it before you set off.',
    badge: 'ASSIGNED',
  },
  PICKED_UP: { label: 'Collected', detail: 'The cargo is aboard.', badge: 'PICKED_UP' },
  IN_TRANSIT: { label: 'On the way', detail: 'Heading to the drop-off.', badge: 'IN_TRANSIT' },
  DELIVERED: { label: 'Delivered', detail: 'Handed over. This leg has paid.', badge: 'DELIVERED' },
  CANCELLED: { label: 'Cancelled', detail: 'This return load came off the leg.', badge: 'CANCELLED' },
};

/** The one step forward from each backhaul state — the rest of the machine is the server's. */
export const BACKHAUL_NEXT: Partial<
  Record<BackhaulBookingState, { to: BackhaulBookingState; label: string }>
> = {
  BOOKED: { to: 'PICKED_UP', label: 'Collect with the sender’s code' },
  PICKED_UP: { to: 'IN_TRANSIT', label: 'Loaded — heading home' },
  IN_TRANSIT: { to: 'DELIVERED', label: 'Delivered' },
};

// ---------------------------------------------------------------------------
// small helpers the screens share
// ---------------------------------------------------------------------------

/** "Tue 2 Sep, 7:00 – 11:00 am" — one line for a booking window. */
export function windowLabel(start: string | Date, end: string | Date): string {
  const from = new Date(start);
  const to = new Date(end);
  const sameDay = from.toDateString() === to.toDateString();

  const day = from.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

  return sameDay
    ? `${day}, ${time(from)} – ${time(to)}`
    : `${day} ${time(from)} → ${to.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${time(to)}`;
}

/** Hours between two instants, rounded up the way the pricing engine bills them. */
export const hoursBetween = (start: Date, end: Date): number =>
  Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 3_600_000));
