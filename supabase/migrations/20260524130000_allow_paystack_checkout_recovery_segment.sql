begin;

alter table public.email_logs
  drop constraint if exists email_logs_segment_check;

alter table public.email_logs
  add constraint email_logs_segment_check check (
    segment in (
      'payment_attempt_no_success',
      'interested_no_payment_attempt',
      'buyer_feedback',
      'incomplete_onboarding',
      'expired_pass',
      'former_buyer',
      'job_alert',
      'non_paying_without_alert',
      'paystack_abandoned_checkout'
    )
  );

alter table public.email_unsubscribe_tokens
  drop constraint if exists email_unsubscribe_tokens_segment_check;

alter table public.email_unsubscribe_tokens
  add constraint email_unsubscribe_tokens_segment_check check (
    segment in (
      'payment_attempt_no_success',
      'interested_no_payment_attempt',
      'buyer_feedback',
      'incomplete_onboarding',
      'expired_pass',
      'former_buyer',
      'job_alert',
      'non_paying_without_alert',
      'paystack_abandoned_checkout'
    )
  );

commit;
