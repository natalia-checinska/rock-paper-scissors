
-- anonimowy użytkownik korzysta ze schematu public
GRANT USAGE ON SCHEMA public TO anon;

-- można jedynie dodawać wiersze, bez czytania, zmiany czy usuwania
GRANT INSERT ON TABLE public.sessions TO anon;
GRANT INSERT ON TABLE public.images TO anon;

CREATE POLICY "anon can insert sessions" ON public.sessions
    FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY "anon can insert images" ON public.images
    FOR INSERT
    TO anon
    WITH CHECK (true);


-- Przesyłanie wycinków dłoni do Storage
CREATE POLICY "anon can upload hand crops" ON storage.objects
    FOR INSERT
    TO anon
    WITH CHECK (bucket_id = 'hand-crops');
