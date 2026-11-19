import { Link } from 'react-router-dom';
import { Icon, PageHeader } from '../components/ui';
import CustomerTransportList from '../components/TransportList';

export default function TransportHomePage() {
  return (
    <>
      <PageHeader title="Замовлення транспорту" crumbs={<><Link to="/catalog">Каталог сервісів</Link> / Доставка та логістика</>}>
        <p className="muted">Замовте авто для перевезення вантажу. Диспетчер візьме заявку в роботу і призначить авто.</p>
      </PageHeader>
      <div className="transport-cta">
        <Link className="btn btn-primary btn-lg" to="/transport/new"><Icon name="truck" /> Замовити транспорт</Link>
      </div>
      <h2 className="section-title">Мої заявки на перевезення</h2>
      <CustomerTransportList />
    </>
  );
}
