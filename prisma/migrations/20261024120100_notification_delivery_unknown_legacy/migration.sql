UPDATE "NotificationDelivery" SET "status" = 'UNKNOWN' WHERE "status" = 'FAILED' AND "lastErrorCode" = 'PROVIDER_SEND_FAILED';
