# MASTER.md (élő dokumentum)

> Ez a dokumentum a platform kötelező fejlesztési szabálykönyve.
> Minden fejlesztés előtt ezt kell figyelembe venni.

# Küldetés

Egységes AI Platform létrehozása, amely minden alkalmazást kiszolgál.

# Alapelvek

- Egy központi platform.
- Minden alkalmazás ugyanazt az AI Gateway-t használja.
- Az AI API kulcsok soha nem kerülhetnek kliensoldalra.
- Minden webes felület a platformon fut.
- Minden adatbázis kezdetben ugyanazon a szerveren fut.
- Docker alapú szolgáltatások.
- Később horizontálisan skálázható architektúra.
- Minden fontos döntést ebben a dokumentumban kell rögzíteni.

# Fejlesztési filozófia

## Dokumentáció az első

Új funkció fejlesztése előtt a kapcsolódó dokumentációt kell elkészíteni vagy frissíteni.

## Kis lépések

Nagy átalakítás helyett kis, önállóan tesztelhető változtatások készülnek.

Minden lépés után:

- build
- deploy
- funkcionális teszt

Csak sikeres teszt után következhet a következő módosítás.

## Nincs gyors javítás

Hibajavítás folyamata:

1. hiba dokumentálása
2. kiváltó ok elemzése
3. javítás
4. tesztelés
5. élesítés

## Moduláris fejlesztés

A rendszer modulonként fejlődik.

Például:

- config
- database
- middleware
- routes
- services
- repositories
- utils

# AI fejlesztési szabály

Minden AI eszköz ugyanazzal a folyamattal dolgozik.

A munka megkezdése előtt kötelező elolvasni:

- docs/MASTER.md
- az érintett szakterület dokumentációját (server.md, database.md, api.md stb.)

A dokumentációtól csak indokolt esetben lehet eltérni, és az eltérést dokumentálni kell.

# Platform szemlélet

A Driver Assistant nem önálló rendszer, hanem az AI Platform első alkalmazása.

A platform közös szolgáltatásai:

- AI Gateway
- Auth
- License
- Shared Database
- Logging
- Monitoring
- Backup
- Admin felület

Minden új alkalmazás ezekre épül.

# Verziózási irányelvek

- v0.1.x – prototípus
- v0.2.x – stabilizálás
- v0.3.x – belső teszt
- v0.5.x – nyilvános béta
- v1.0.0 – első stabil kiadás

# Dokumentáció

A platform dokumentumai:

- MASTER.md
- server.md
- database.md
- api.md
- android.md
- web.md
- security.md
- deployment.md

Ez a dokumentum folyamatosan bővül.
