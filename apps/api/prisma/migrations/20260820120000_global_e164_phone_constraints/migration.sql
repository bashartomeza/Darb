-- Keep full numbering-plan validation in libphonenumber-js/max. This check is
-- defense in depth for values that have already been canonicalized by the
-- application: a literal plus followed by 1-15 ASCII digits, with a non-zero
-- first digit as required by E.164.
ALTER TABLE `onboarding_attempts`
    DROP CHECK `onboarding_attempts_phone_e164_chk`,
    ADD CONSTRAINT `onboarding_attempts_phone_e164_chk`
      CHECK (
        CHAR_LENGTH(`phone_e164`) BETWEEN 2 AND 16
        AND `phone_e164` REGEXP '^\\+[1-9][0-9]{0,14}$'
      );
