import { Link } from 'react-router-dom';
import { useApp } from '../context';
import { Icon, PageHeader } from '../components/ui';

const SERVICES = [
  { key: 'purchase', icon: 'cart', title: 'Запит на закупівлю', text: 'Планова потреба в товарах для локацій: господарські товари та витратні матеріали.', to: '/catalog/purchase', active: true },
  { key: 'transport', icon: 'truck', title: 'Замовлення транспорту', text: 'Доставка та логістика: перевезення вантажу між адресами, призначення авто диспетчером.', to: '/catalog/transport', active: true },
  { key: 'repair', icon: 'wrench', title: 'Запит на ремонт', text: 'Ремонт обладнання, приміщень та інженерних мереж.', active: false },
  { key: 'it', icon: 'laptop', title: 'ІТ-підтримка', text: 'Техніка, доступи, програмне забезпечення.', active: false },
];

export default function CatalogPage() {
  const { user } = useApp();
  const canCreate = user?.role === 'customer';
  return (
    <>
      <PageHeader title="Каталог сервісів">
        <p className="muted">Оберіть сервіс, щоб створити заявку.</p>
      </PageHeader>
      <div className="service-grid">
        {SERVICES.map((s) => {
          const enabled = s.active && canCreate;
          const inner = (
            <>
              <span className="service-icon"><Icon name={s.icon} size={22} /></span>
              <span className="service-body">
                <span className="service-title">
                  {s.title}
                  {!s.active && <span className="lozenge lozenge-grey">незабаром</span>}
                </span>
                <span className="service-text">{s.text}</span>
                {s.active && !canCreate && <span className="muted small">Заявки створюють замовники; ваші заявки — у меню ліворуч</span>}
              </span>
            </>
          );
          return enabled ? (
            <Link key={s.key} to={s.to!} className="service-card">{inner}</Link>
          ) : (
            <div key={s.key} className="service-card is-disabled" aria-disabled="true">{inner}</div>
          );
        })}
      </div>
    </>
  );
}
