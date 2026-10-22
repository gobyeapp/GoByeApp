import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { MOCK_SERVICE_CONFIG, categoryName, type ServiceConfig, type VehicleCategoryId } from '@gobye/core';
import { useServices } from './services';

/**
 * Admin-published service settings (enabled vehicle categories, referral programme, pickup PIN).
 * Starts from the bundled defaults so the UI never blocks, then refreshes from the config service.
 */
const ConfigContext = createContext<ServiceConfig>(MOCK_SERVICE_CONFIG);

export function ServiceConfigProvider({ children }: { children: ReactNode }) {
  const { config } = useServices();
  const [value, setValue] = useState<ServiceConfig>(MOCK_SERVICE_CONFIG);
  useEffect(() => {
    let active = true;
    config
      .getServiceConfig()
      .then((c) => active && setValue(c))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [config]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useServiceConfig(): ServiceConfig {
  return useContext(ConfigContext);
}

/** Category display name from admin config (falls back to the id). */
export function useCategoryName(): (id: VehicleCategoryId) => string {
  const config = useServiceConfig();
  return (id) => categoryName(config, id);
}
