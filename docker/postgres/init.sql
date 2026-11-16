-- Runs once, when the database volume is first created.
-- The main database ("eneba") is created by the image itself; tests get their
-- own database so running the suite never touches development data.
CREATE DATABASE eneba_test OWNER eneba;
