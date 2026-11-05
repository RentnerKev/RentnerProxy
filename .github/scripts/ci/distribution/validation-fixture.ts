// The fixture writes only its canary and always rejects validation. A generated
// column causes this SQL to execute while pg_restore loads the table's data.
export const validationAttackSql = `
    CREATE FUNCTION rentnerproxy.validation_probe(input_value integer) RETURNS text
        LANGUAGE plpgsql IMMUTABLE AS $function$ BEGIN RETURN 'safe'; END; $function$;
    CREATE TABLE rentnerproxy.validation_attack (id integer,
        generated_value text GENERATED ALWAYS AS (rentnerproxy.validation_probe(id)) STORED);
    INSERT INTO rentnerproxy.validation_attack(id) VALUES (1);
    CREATE FUNCTION rentnerproxy.validation_write() RETURNS void
        LANGUAGE plpgsql VOLATILE AS $function$
        BEGIN
            COPY (SELECT 'fixture') TO PROGRAM 'sh -c ''if test -f /var/lib/rentnerproxy/postgres-data/PG_VERSION; then printf overwritten > /var/lib/rentnerproxy/postgres-data/validation-canary; fi; exit 1''';
        END; $function$;
    CREATE OR REPLACE FUNCTION rentnerproxy.validation_probe(input_value integer) RETURNS text
        LANGUAGE plpgsql IMMUTABLE AS $function$
        BEGIN
            PERFORM rentnerproxy.validation_write();
            RETURN 'changed';
        END; $function$;
`
