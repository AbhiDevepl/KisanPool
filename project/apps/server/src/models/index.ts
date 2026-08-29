/*
 * FIRST — registers the fault-simulation gate as a global Mongoose plugin.
 *
 * A global plugin only applies to schemas compiled after it, so this import must
 * precede every model below. Moving it breaks the blackout simulation silently:
 * the gate applies to nothing and the demo appears to do nothing (ADR-044).
 */
import './../modules/resilience/simulation';

export { User } from './User';
export { Vehicle } from './Vehicle';
export { KycDocument } from './Document';
export { TransportRequest } from './TransportRequest';
export { Payment } from './Payment';
export { TransporterPayoutAccount } from './TransporterPayoutAccount';
export { Rating } from './Rating';
export { ChatMessage } from './ChatMessage';
export { AiSession } from './AiSession';
export { Trip } from './Trip';
export { TripShipment } from './TripShipment';
export { TransporterOffer } from './TransporterOffer';
export { PricingEvent } from './PricingEvent';
export { WebhookEvent } from './WebhookEvent';

// V2 — Farm Resource Network
export { FarmMachine } from './FarmMachine';
export { MachineBooking } from './MachineBooking';
// V2 — Backhaul Network
export { BackhaulRequest } from './BackhaulRequest';
export { BackhaulBooking } from './BackhaulBooking';

export type { UserDoc } from './User';
export type { VehicleDoc } from './Vehicle';
export type { KycDocumentDoc } from './Document';
export type { TransportRequestDoc } from './TransportRequest';
export type { PaymentDoc } from './Payment';
export type { PayoutAccountDoc } from './TransporterPayoutAccount';
export type { RatingDoc } from './Rating';
export type { ChatMessageDoc } from './ChatMessage';
export type { AiSessionDoc } from './AiSession';
export type { TripDoc } from './Trip';
export type { TripShipmentDoc } from './TripShipment';
export type { TransporterOfferDoc } from './TransporterOffer';
export type { PricingEventDoc } from './PricingEvent';
export type { WebhookEventDoc } from './WebhookEvent';

export type { FarmMachineDoc } from './FarmMachine';
export type { MachineBookingDoc } from './MachineBooking';
export type { BackhaulRequestDoc } from './BackhaulRequest';
export type { BackhaulBookingDoc } from './BackhaulBooking';
