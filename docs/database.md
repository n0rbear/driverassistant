# database.md

# Adatbázis szabvány

Ez a dokumentum a platform összes PostgreSQL adatbázisára érvényes.

## 1. Alapelvek

- PostgreSQL az elsődleges adatbázis.
- Az alkalmazások **soha nem kapcsolódhatnak közvetlenül** az adatbázishoz.
- Minden adat a backend API-n keresztül érhető el.
- Minden rekord UUID alapú azonosítót használ.
- A szinkronizáció alapja az `updatedAt` mező.

## 2. Kötelező mezők

Minden üzleti táblában törekedni kell az alábbi mezőkre:

```text
id (UUID)
createdAt
updatedAt
deletedAt (ha soft delete)
isDeleted
```

## 3. Soft delete

Rekordot lehetőség szerint nem törlünk fizikailag.

```text
isDeleted = true
deletedAt = timestamp
```

A kliens alapértelmezetten csak a nem törölt rekordokat kapja vissza.

## 4. Szinkronizáció

A Driver Assistant jelenlegi modellje marad:

- UUID alapú rekordazonosítás
- last-writer-wins
- updatedAt összehasonlítás
- offline működés támogatása

## 5. JSONB

JSONB csak akkor használható, ha valóban indokolt.

Jelenlegi ismert példa:

- items

## 6. Indexelés

Index szükséges:

- UUID
- updatedAt
- idegen kulcsok
- gyakran szűrt mezők

## 7. Mentések

- napi automatikus dump
- titkosított tárolás
- rendszeres visszaállítási teszt

## 8. Migrációk

Minden sémaváltozás migrációval történik.

Kézi adatbázis-módosítás nem megengedett.

## 9. Biztonság

Az adatbázis csak backendből érhető el.

A DATABASE_URL kizárólag környezeti változóban tárolható.

## 10. Következő feladat

A Driver Assistant jelenlegi adatbázisát teljesen dokumentálni kell:

- táblák
- mezők
- indexek
- kapcsolatok
- constraint-ek
- JSONB mezők
- trigger-ek (ha vannak)

Ez lesz a database.md következő bővítési fázisa.
