# Audit local AfricaTalents prioritaires

Généré le 2026-05-09T06:15:31.897Z.

Périmètre: Sénégal, Cameroun, Maroc. Maximum 2 pages téléchargées par pays. Aucun appel Supabase, aucun import, aucune écriture production.

## Résumé

| Pays | URL | Total annoncé | Pages détectées | Pages auditées | Offres parsées | Champs manquants | Suspectes | Doublons IDs | Répétitives | Score | Reco |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Sénégal | https://www.emploisenegal.com/recherche-jobs-senegal | 239 | 10 | 2 | 50 | 0% | 1 | 0 | 0 | go | go |
| Cameroun | https://www.emploi.cm/recherche-jobs-cameroun | n/a | 0 | 0 | 0 | 100% | 0 | 0 | 0 | no-go | no-go |
| Maroc | https://www.emploi.ma/recherche-jobs-maroc | 740 | 30 | 2 | 50 | 1.2% | 0 | 0 | 0 | go | go |

## Sénégal

- URL listing: https://www.emploisenegal.com/recherche-jobs-senegal
- Préfixe external_id proposé: `emploisenegal_portal`
- IDs numériques détectés: 50/50
- Risque doublons: faible
- Score qualité: go
- Recommandation: go

### Exemples

| external_id | title | company_name | location | contract_type | published_at | missing | suspicious | source_url |
|---|---|---|---|---|---|---|---|---|
| emploisenegal_portal:1541656 | Technico-Commercial (e) - Dakar | TIENS DS COM | Dakar & International | CDI & CDD | 2026-05-09T00:00:00.000Z |  |  | https://www.emploisenegal.com/offre-emploi-senegal/technico-commercial-e-dakar-1541656 |
| emploisenegal_portal:1571884 | Téléconseiller(ère) Francophone ou Anglophone - Dakar | SANTELIA | Dakar & International | CDD, Freelance & Temps partiel | 2026-05-08T00:00:00.000Z |  |  | https://www.emploisenegal.com/offre-emploi-senegal/teleconseillerere-francophone-anglophone-dakar-1571884 |
| emploisenegal_portal:1571783 | Agronome Terrain - Sokone, Keur Aliou Gueye | ESPEN ORGANICS SENEGAL SARL | Fatick & Kaolack | CDD | 2026-05-08T00:00:00.000Z |  |  | https://www.emploisenegal.com/offre-emploi-senegal/agronome-terrain-sokone-keur-aliou-gueye-1571783 |
| emploisenegal_portal:1572591 | Assistant - Diamniadio | VIGOR INDUSTRIES | Dakar | CDD | 2026-05-08T00:00:00.000Z |  |  | https://www.emploisenegal.com/offre-emploi-senegal/assistant-diamniadio-1572591 |
| emploisenegal_portal:1572440 | Télévendeur(euse) - Dakar | GROUPE TALISO | Dakar | CDD, Stage & Freelance | 2026-05-08T00:00:00.000Z |  |  | https://www.emploisenegal.com/offre-emploi-senegal/televendeureuse-dakar-1572440 |

### Annonces suspectes signalées

- Agent de Chat en Ligne - Paris / Warben Growth Consulting LLC: crypto (https://www.emploisenegal.com/offre-emploi-senegal/agent-chat-ligne-paris-1570230)

## Cameroun

- URL listing: https://www.emploi.cm/recherche-jobs-cameroun
- Préfixe external_id proposé: `emploi_cm_portal`
- IDs numériques détectés: 0/0
- Risque doublons: faible
- Score qualité: no-go
- Recommandation: no-go
- Erreur: 403 Forbidden

### Exemples

| external_id | title | company_name | location | contract_type | published_at | missing | suspicious | source_url |
|---|---|---|---|---|---|---|---|---|

## Maroc

- URL listing: https://www.emploi.ma/recherche-jobs-maroc
- Préfixe external_id proposé: `emploi_ma_portal`
- IDs numériques détectés: 49/50
- Risque doublons: faible
- Score qualité: go
- Recommandation: go

### Exemples

| external_id | title | company_name | location | contract_type | published_at | missing | suspicious | source_url |
|---|---|---|---|---|---|---|---|---|
| emploi_ma_portal:9272501 | Ingénieur Process (H/F) - Casablanca | EXPERT EYE ENGINEERING | Casablanca-Mohammedia | CDI | 2026-05-09T00:00:00.000Z |  |  | https://www.emploi.ma/offre-emploi-maroc/ingenieur-process-hf-casablanca-9272501 |
| emploi_ma_portal:9273985 | Responsables de Magasin - Casablanca et El Jadida | MARJANE MARKET | Casablanca-Mohammedia | CDI | 2026-05-09T00:00:00.000Z |  |  | https://www.emploi.ma/offre-emploi-maroc/responsables-magasin-casablanca-el-jadida-9273985 |
| emploi_ma_portal:9274345 | Consultant Chef Pâtissier - Casablanca | GROUPE MCE | Casablanca-Mohammedia | Freelance | 2026-05-09T00:00:00.000Z |  |  | https://www.emploi.ma/offre-emploi-maroc/consultant-chef-patissier-casablanca-9274345 |
| emploi_ma_portal:9278628 | Ingénieur(e) d’Études en Génie Civil - Chef de Projets - Barrage - Rabat | INNOV ENGINEERING CONSULTING | Rabat-Salé-Kénitra | CDI | 2026-05-09T00:00:00.000Z |  |  | https://www.emploi.ma/offre-emploi-maroc/ingenieure-etudes-genie-civil-chef-projets-barrage-rabat-9278628 |
| emploi_ma_portal:9287543 | Chef de Projet Trade Marketing - Casablanca | DIRECT SALES | Casablanca-Mohammedia | CDI | 2026-05-09T00:00:00.000Z |  |  | https://www.emploi.ma/offre-emploi-maroc/chef-projet-trade-marketing-casablanca-9287543 |

## Notes techniques

- Les IDs numériques sont préfixés par source pays pour éviter les collisions entre domaines AfricaTalents.
- Les mots suspects sont signalés seulement; le script ne filtre pas agressivement.
- Le taux de champs manquants est calculé sur external_id, title, company_name, country, location, contract_type, published_at, source_url, apply_url, description_short.
