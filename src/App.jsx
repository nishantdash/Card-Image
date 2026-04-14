import { AppProvider, useApp } from './context/AppContext.jsx';
import TopBar from './components/TopBar.jsx';
import CustomerView from './views/CustomerView.jsx';
import OpsView from './views/OpsView.jsx';
import Modal from './components/Modal.jsx';
import Toast from './components/Toast.jsx';

function Shell() {
  const { view } = useApp();
  return (
    <>
      <TopBar />
      <main>
        <section className={`view ${view === 'customer' ? 'active' : ''}`} id="view-customer">
          {view === 'customer' && (
            <div className="mobile-frame-wrap">
              <div className="mobile-frame">
                <div className="mobile-frame-notch"></div>
                <div className="mobile-frame-screen">
                  <CustomerView />
                </div>
              </div>
            </div>
          )}
        </section>
        <section className={`view ${view === 'ops' ? 'active' : ''}`} id="view-ops">
          {view === 'ops' && <OpsView />}
        </section>
      </main>
      <Modal />
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
