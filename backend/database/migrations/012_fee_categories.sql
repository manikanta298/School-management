ALTER TABLE fee_payments DROP CONSTRAINT fee_payments_method_check;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_method_check CHECK(method IN ('cash','upi','bank_transfer','cheque','online','other'));
ALTER TABLE fee_structures ADD COLUMN category varchar(20) NOT NULL DEFAULT 'miscellaneous' CHECK(category IN ('admission','tuition','term','examination','transport','books','uniform','activity','miscellaneous'));
