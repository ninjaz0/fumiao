"""Explicit funding for existing tests focused on non-billing features."""
def fund_test_accounts():
    import core
    with core.db(True) as con:
        con.execute('UPDATE credit_prices SET amount=1')
        con.execute('UPDATE credit_accounts SET balance=1000000')
        con.execute('''CREATE TRIGGER IF NOT EXISTS test_wallet_funding AFTER INSERT ON credit_accounts BEGIN
            UPDATE credit_accounts SET balance=1000000 WHERE workspace=NEW.workspace; END''')
