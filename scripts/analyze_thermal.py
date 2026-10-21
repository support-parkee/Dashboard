import json

with open('data/fleet.json', 'r', encoding='utf-8') as f:
    fleet = json.load(f)

print(f"Total fleet records: {len(fleet)}")

# Criteria for Server vs Client
# Server hosts typically contain 'server', 'srv', 'admin', 'master', 'pusat' or cat is 'Server'/'Admin'
def is_server(d):
    h = d['host'].lower()
    c = d['cat'].lower()
    return ('server' in h or 'srv' in h or 'admin' in h or 'master' in h or c in ['server', 'admin'])

servers = [d for d in fleet if is_server(d)]
clients = [d for d in fleet if not is_server(d)]

print(f"Total Servers / Admins: {len(servers)}")
print(f"Total Clients (Gates, Pos, Cashiers): {len(clients)}")

server_temps = [d for d in servers if d['temp'] is not None]
client_temps = [d for d in clients if d['temp'] is not None]

print(f"Servers with temperature data: {len(server_temps)}")
print(f"Clients with temperature data: {len(client_temps)}")

server_overheats = [d for d in server_temps if d['temp'] >= 80]
client_overheats = [d for d in client_temps if d['temp'] >= 80]

print(f"\n>>> Server Overheats (>= 80C): {len(server_overheats)} units")
print(f">>> Client Overheats (>= 80C): {len(client_overheats)} units")

print("\n--- TOP 15 OVERHEATED SERVERS ---")
for s in sorted(server_overheats, key=lambda x: x['temp'], reverse=True)[:15]:
    print(f"{s['temp']}°C | {s['loc']} | {s['host']} | Tier: {s['tier']} | CPU: {s['cpu_family']} | ZT: {s['zt']}")

print("\n--- SERVER TEMP RANGES ---")
ranges = [
    ("< 50°C (Cool)", 0, 50),
    ("50-69°C (Normal)", 50, 70),
    ("70-79°C (Warm)", 70, 80),
    ("80-89°C (Hot)", 80, 90),
    (">= 90°C (Critical)", 90, 200)
]
for label, lo, hi in ranges:
    cnt = sum(1 for d in server_temps if lo <= d['temp'] < hi)
    pct = (cnt / len(server_temps) * 100) if server_temps else 0
    print(f"  {label}: {cnt} ({pct:.1f}%)")

print("\n--- CLIENT TEMP RANGES ---")
for label, lo, hi in ranges:
    cnt = sum(1 for d in client_temps if lo <= d['temp'] < hi)
    pct = (cnt / len(client_temps) * 100) if client_temps else 0
    print(f"  {label}: {cnt} ({pct:.1f}%)")
