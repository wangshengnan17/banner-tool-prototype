import sqlite3, os, base64

db = sqlite3.connect("pb_data/data.db")

def pb_id():
    return base64.urlsafe_b64encode(os.urandom(15)).decode('ascii').rstrip('=')[:15]

# Create test user
uid = pb_id()
db.execute("INSERT INTO users(id,email,verified,display_name,role) VALUES(?,?,1,?,?)",
           [uid, "test@banner.local", "测试用户", "designer"])
print(f"User: {uid}")

# Create project
pid = pb_id()
db.execute("INSERT INTO projects(id,name,status,owner) VALUES(?,?,?,?)",
           [pid, "618活动", "active", uid])
print(f"Project: {pid}")

# Create tasks and iterations
tids = []
for i, tname in enumerate(["首页Banner", "频道页Banner", "弹窗广告"]):
    tid = pb_id()
    db.execute("INSERT INTO tasks(id,name,status,project,owner) VALUES(?,?,?,?,?)",
               [tid, tname, "active", pid, uid])
    tids.append(tid)
    print(f"Task {i}: {tid} ({tname})")

    for v in range(1, 4):
        it_id = pb_id()
        statuses = ["draft", "generated", "generated"]
        is_best = 1 if v == 2 else 0
        notes = ["初版尝试", "优化后版本", "最终调整"][v-1]
        db.execute("INSERT INTO iterations(id,task,version,status,notes,is_best) VALUES(?,?,?,?,?,?)",
                   [it_id, tid, v, statuses[v-1], notes, is_best])
        print(f"  Iter v{v}: {it_id} best={is_best}")

db.commit()
db.close()
print("\nDONE!")
