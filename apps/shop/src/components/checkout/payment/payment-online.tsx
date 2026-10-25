import { useTranslation } from 'next-i18next/pages';

const PaymentOnline = () => {
  const { t } = useTranslation('common');
  return (
    <span className="block text-sm text-body">{t('text-payment-order')}</span>
  );
};
export default PaymentOnline;
