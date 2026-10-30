const StatusColor = (status: string) => {
  let bg_class = '';
  if (
    status?.toLowerCase() === 'order-pending' ||
    status?.toLowerCase() === 'pending' ||
    status?.toLowerCase() === 'payment-pending'
  ) {
    bg_class = 'bg-status-pending/10 text-status-pending';
  } else if (
    status?.toLowerCase() === 'order-processing' ||
    status?.toLowerCase() === 'processing' ||
    status?.toLowerCase() === 'payment-processing'
  ) {
    bg_class = 'bg-status-processing/10 text-status-processing';
  } else if (
    status?.toLowerCase() === 'order-completed' ||
    status?.toLowerCase() === 'approved' ||
    status?.toLowerCase() === 'payment-success'
  ) {
    bg_class = 'bg-status-complete/10 text-status-complete';
  } else if (
    status?.toLowerCase() === 'order-cancelled' ||
    status?.toLowerCase() === 'rejected' ||
    status?.toLowerCase() === 'payment-reversal'
  ) {
    bg_class = 'bg-status-canceled/10 text-status-canceled';
  } else if (
    status?.toLowerCase() === 'order-failed' ||
    status?.toLowerCase() === 'payment-failed'
  ) {
    bg_class = 'bg-status-failed/10 text-status-failed';
  } else if (status?.toLowerCase() === 'order-at-local-facility') {
    bg_class =
      'bg-status-out-for-delivery/10 text-status-out-for-delivery';
  } else if (status?.toLowerCase() === 'order-out-for-delivery') {
    bg_class =
      'bg-status-out-for-delivery/10 text-status-out-for-delivery';
  } else if (
    status?.toLowerCase() === 'order-refunded' ||
    status?.toLowerCase() === 'refunded' ||
    status?.toLowerCase() === 'payment-refunded'
  ) {
    bg_class = 'bg-rose-400/10 text-status-pending';
  } else {
    bg_class = 'bg-accent/10 !text-accent';
  }

  return bg_class;
};

export default StatusColor;
