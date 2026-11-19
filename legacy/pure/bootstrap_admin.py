"""Issue a private, single-use first-admin code on a fresh installation."""
from core import db, now, SITE
from invitations import generate_code

with db(True) as con:
    if con.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
        raise SystemExit("An administrator already exists")
    con.execute("UPDATE registration_codes SET enabled=0 WHERE role='admin'")
    code = generate_code()
    con.execute("INSERT INTO registration_codes(code,name,role,expires) VALUES(?,'管理员初始化','admin',?)", (code,now()+86400))
    print("注册页面：" + SITE + "/studio#register")
    print("管理员初始化邀请码（仅一次）：" + code)
