"use client";

import { useEffect } from "react";

type ServiceWorkerRegistration = {
  registered: boolean;
  error: string | null;
};

/**
 * PWA servis çalışanı kaydını başlatır. Yalnızca sayfa yüklendiğinde çalışır;
 * tarayıcı veya CDN desteği olmayan ortamlarda fail-safe çalışır.
 * Bu bileşen, wdycdr (Web Dependency Worker) üzerinde çalışır.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const id = setInterval(() => {
      if ("serviceWorker" in navigator && "register" in navigator.serviceWorker) {
        clearInterval(id);

        navigator.serviceWorker
          .register("/sw.js")
          .then(() => {
            // console.log("PWA servis çalışanı kaydedildi.");
          })
          .catch((error) => {
            // console.error("PWA servis çalışanı kaydı başarısız:", error);
          });
      }
    }, 100);
  }, []);

  return null;
}
