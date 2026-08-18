#!/usr/bin/env python3
"""Розширений аналіз: по дистанції, зоні, годині. Запуск: python3 report.py"""
import json

d = json.load(open("data.json"))
s = d["settings"]
fpk = s["gas_consumption_l_100km"] / 100 * s["gas_price_per_l"]
thr = s["threshold_net_per_km"]


def enrich(t):
    a, dist = t["amount"], t["distance"]
    comm = a * s["commission_uklon_pct"] / 100
    if t["payment"] == "Безготівка":
        comm += a * s["commission_cashless_pct"] / 100
    gas = dist * (1 + s["empty_run_coef"]) * fpk
    net = a - comm - gas
    return dict(t, gas=gas, comm=comm, net=net, npk=net / dist, gpk=a / dist,
                hour=int(t["datetime"].split()[1].split(":")[0]))


rows = [enrich(t) for t in d["trips"]]


def block(name, sub):
    if not sub:
        return
    n = len(sub)
    amt = sum(r["amount"] for r in sub)
    km = sum(r["distance"] for r in sub)
    net = sum(r["net"] for r in sub)
    npk = net / km if km else 0
    bad = sum(1 for r in sub if r["npk"] < thr)
    print(f"{name:22} | n={n:2} | виручка={amt:5.0f} | чист={net:6.0f} | "
          f"чист/км={npk:5.1f} | нижче порогу={bad:2} ({bad/n*100:3.0f}%)")


print(f"Поріг «доброї» поїздки: {thr} грн/км чистими | беззбитк.={fpk*(1+s['empty_run_coef']):.1f}")
print("=" * 92)
print("ЗА ДИСТАНЦІЄЮ")
block("Коротка (<3 км)", [r for r in rows if r["distance"] < 3])
block("Середня (3-7 км)", [r for r in rows if 3 <= r["distance"] < 7])
block("Довга (7-12 км)", [r for r in rows if 7 <= r["distance"] < 12])
block("Дуже довга (12+ км)", [r for r in rows if r["distance"] >= 12])
print("-" * 92)
print("ЗА ЗОНОЮ ПРИЗНАЧЕННЯ")
block("Місто", [r for r in rows if r["zone"] == "Місто"])
block("Глухий кут", [r for r in rows if r["zone"] == "Глухий кут"])
print("-" * 92)
print("ЗА ГОДИНОЮ")
for lo, hi, nm in [(0, 17, "до 17:00"), (17, 19, "17-19 (пік)"),
                   (19, 21, "19-21 (вечір)"), (21, 24, "після 21")]:
    block(nm, [r for r in rows if lo <= r["hour"] < hi])
print("-" * 92)
print("ЗА ОПЛАТОЮ")
for p in ("Готівка", "Безготівка", "Комбінована"):
    block(p, [r for r in rows if r["payment"] == p])
print("=" * 92)
worst = sorted(rows, key=lambda r: r["npk"])[:8]
print("НАЙГІРШІ 8 (кандидати відсікати):")
for r in worst:
    print(f"  {r['datetime']} {r['amount']:>3}грн {r['distance']:>5}км "
          f"чист/км={r['npk']:4.1f}  {r['zone']:10} {r['from'][:22]:22}→ {r['to'][:22]}")

