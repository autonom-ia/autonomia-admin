UPDATE admin.products
SET register_callback_url = 'https://neuroai.autonomia.site/register/callback',
    updated_at = now()
WHERE key = 'neuroai-web';
