import { Routes, Route } from 'react-router';
import { HermesChatPage } from './pages/HermesChatPage';
import { ProductPanelPage } from './pages/ProductPanelPage';

export default function App() {
  return (
    <Routes>
      <Route index element={<HermesChatPage />} />
      <Route path="product-panel" element={<ProductPanelPage />} />
    </Routes>
  );
}
