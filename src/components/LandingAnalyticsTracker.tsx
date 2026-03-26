import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { trackLandingPageView } from "../lib/analytics";

export default function LandingAnalyticsTracker() {
  const location = useLocation();

  useEffect(() => {
    trackLandingPageView(location.pathname, location.search);
  }, [location.pathname, location.search]);

  return null;
}
