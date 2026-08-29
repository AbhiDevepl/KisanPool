/** Indian-format rupee display. Money always arrives from the server, never computed here. */
export const rupees = (value: number): string =>
  `₹${Math.round(value).toLocaleString('en-IN')}`;

export const kg = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} ton` : `${value} kg`;

export const km = (value: number): string => `${value.toFixed(1)} km`;

export function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function shortDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Human labels for all three lifecycles (request, trip, shipment). They share one
 * map because no state name collides across them and a screen usually shows a mix.
 */
const STATUS_LABEL: Record<string, string> = {
  // request
  OPEN: 'Waiting for transporters',
  TRANSPORTER_INTERESTED: 'Transporters interested',
  CONFIRMED: 'Transporter chosen',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  // offer
  INTERESTED: 'Waiting for the farmer',
  SELECTED: 'Chosen',
  WITHDRAWN: 'Withdrawn',
  REJECTED: 'Not chosen',
  // trip
  FORMING: 'Taking more loads',
  EN_ROUTE: 'On the way to pickup',
  AT_DESTINATION: 'At the mandi',
  COMPLETED: 'Completed',
  // shipment
  ASSIGNED: 'Booked',
  ARRIVED: 'Driver has arrived',
  PICKED_UP: 'Loaded',
  IN_TRANSIT: 'On the way',
  DELIVERED: 'Delivered',
  PAYMENT_PENDING: 'Payment due',
  PAID: 'Paid',
};

export const statusLabel = (status: string): string =>
  STATUS_LABEL[status] ?? status.replace(/_/g, ' ').toLowerCase();
