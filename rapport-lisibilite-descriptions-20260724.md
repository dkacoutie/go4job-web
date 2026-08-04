# Lisibilité des descriptions d'offres — audit et correctif

Date : 24/07/2026
Branche : dev
Commit : `79d5429`
Domaine vérifié en direct : `jobradar.go4jobapp.com`

## Cause racine

Le problème n'est pas dans le CSS. Il vient de deux endroits distincts, et un troisième aggrave les deux premiers.

**1. Ingestion (cause dominante, ~248 886 offres actives sur 274 348, soit 90,7 %).** La fonction `stripHtmlLikeText()` (dupliquée dans une dizaine de scrapers, dont `france_travail_api.ts` et `adzuna_api.ts`) appliquait `.replace(/\s+/g, " ")` au texte de la description avant stockage. Cette expression régulière traite un saut de ligne comme un espace ordinaire et le supprime. France Travail (154 988 offres actives, 56 % des offres sans HTML) fournit pourtant un texte structuré, avec de vrais retours à la ligne et des puces (`*` ou `-`) : ce texte est aplati en un seul bloc avant même d'atteindre la base de données. C'est visible directement sur l'offre "Test Lead F/H" citée : la base contenait littéralement `"...campagnes de test. * Composition du pôle : ..."`, l'astérisque de puce ayant perdu son retour à la ligne.

**2. Rendu frontend.** `JobDetailsPage.tsx` n'affichait la description que de deux façons : le HTML de la source (`description_html`), sanitizé et affiché tel quel — ou, à défaut, le texte brut dans un `<div style="white-space: pre-wrap">`, sans aucune interprétation. Un texte qui contient déjà des puces ou des intitulés de rubrique n'était jamais transformé en liste ou en titre : il restait un bloc de texte avec des caractères de puce visibles au milieu.

**3. CSS, qui aggravait aussi les offres déjà bien structurées.** `.jd-desc { white-space: pre-wrap }` s'appliquait sans distinction au conteneur du texte brut ET à celui du HTML natif (`.jd-html`, qui hérite de `.jd-desc`), sans qu'aucune règle ne vienne le neutraliser pour le HTML. Combiné à l'absence de toute typographie dédiée (pas de marge entre paragraphes, pas d'indentation de liste, pas de hiérarchie de titres), même les ~9,3 % d'offres qui avaient un bon HTML source (Agence Emploi Jeunes, Himalayas, Projobivoire...) n'avaient pas un rendu vraiment éditorial.

## Différences entre sources (vérifié en base, échantillon multi-pays)

| Source | Offres actives | HTML fourni | Constat |
|---|---|---|---|
| France Travail API | 154 988 | Aucun | Texte structuré à l'origine, aplati par le scraper. Cause dominante. |
| Adzuna (API/Partner) | 92 399 | Aucun | L'API Adzuna ne fournit qu'un extrait court (moy. 498 caractères) : rien à restructurer, ce n'est pas un bug JobRadar. |
| Emploi.ci, Emploi Sénégal, Emploi.ci Portal | ~1 500 au total | Aucun (mis à `null` explicitement dans l'orchestrateur `ingest_source/index.ts`, même quand un scraper pourrait fournir mieux) | Texte généralement en un seul paragraphe, peu de puces dans la source elle-même. |
| MyJobMag Nigeria | 792 | Aucun | Texte déjà en paragraphes cohérents côté source, pas de perte visible. |
| Agence Emploi Jeunes, Himalayas API, Projobivoire RSS, NGO Jobs in Africa | ~14 000 au total | Oui, HTML réel (`<p>`, `<ul><li>`) | Déjà bien structuré à la source ; seul le CSS le pénalisait. |

Confirmation directe en base que plusieurs colonnes existent (`description_text`, `description_html`, `official_desc`, `ai_description`) et que la priorité utilisée par le frontend (HTML natif > texte officiel > texte scrapé > texte extrait du JSON brut > IA) est correcte : le problème n'est pas un mauvais choix de colonne, c'est l'absence de contenu exploitable dans `description_html` pour 90 % des offres, combinée à l'aplatissement du texte à l'ingestion pour la plus grosse source.

## Solution retenue

Discutée : (a) refaire tourner un modèle d'IA sur chaque description à l'ouverture — écarté explicitement par la consigne coût/latence ; (b) une migration qui réécrit `description_html` en base pour toutes les offres existantes — écarté, plus risqué et sans bénéfice réel par rapport à (c) ; (c) reconstruire la structure à la lecture, dans le frontend, à partir du texte déjà stocké.

**Retenue : (c).** Un nouveau module `src/lib/jobDescriptionFormat.ts` transforme le texte brut en HTML structuré et sûr, exécuté au moment de l'affichage de la page (coût : quelques opérations de texte sur une chaîne de quelques Ko, comparable au sanitizing déjà en place, aucun appel réseau ni IA). Il reconnaît uniquement des marqueurs réellement présents dans le texte :
- les retours à la ligne réels, quand ils existent ;
- les puces `-`, `*`, `•`, `▪`, `‣`, `●` ou numérotées (`1.`, `1)`) en début de ligne ;
- une liste fermée d'intitulés de rubrique (Missions, Profil recherché, Compétences, Conditions, Avantages, Responsibilities, Requirements, Benefits...) uniquement quand ils sont suivis de deux-points ;
- pour les textes sans aucun retour à la ligne (le cas France Travail déjà en base), deux règles ciblées et bornées reconstruisent les puces aplaties : le motif `" * "` (observé chez France Travail) et le motif `" - Majuscule"` (observé dans plusieurs listes réelles), chacun seulement si le motif apparaît au moins 2 ou 3 fois pour écarter un tiret ou un astérisque isolé sans rapport avec une liste (ex : "2000 * 12 mois" reste un texte normal).

Aucune rubrique n'est inventée : un texte sans marqueur reconnu reste un paragraphe simple, inchangé sur le fond. Le HTML déjà fourni par une source n'est jamais retouché.

Cette approche a été choisie plutôt qu'une réécriture des scrapers seule, parce qu'elle bénéficie **immédiatement** à toutes les offres déjà en base (aucune migration, donnée jamais modifiée) et reste homogène quelle que soit la source, y compris pour d'éventuelles nouvelles sources à l'avenir.

## Sécurité

Le texte brut est échappé (`&`, `<`, `>`, `"`, `'`) avant toute construction de structure. Le HTML assemblé (qu'il vienne du texte reconstruit ou de la source) passe ensuite par le même sanitizer DOMPurify strict que l'existant (liste blanche de balises : `p, br, strong, em, ul, ol, li, a, h1-h6, blockquote, table, hr, code, pre...`, pas de `style`, pas d'attributs `on*`, pas de `script`/`iframe`). Testé avec des charges XSS placées directement dans le texte brut (`<script>alert(1)</script>`, `<img src=x onerror=alert(2)>`, `javascript:alert(3)`) : elles ressortent comme texte visible inerte, jamais exécutées.

## Fichiers modifiés

- **`src/lib/jobDescriptionFormat.ts`** (nouveau) : normaliseur texte → HTML sûr, décrit ci-dessus. Contient aussi `sanitizeHtmlBasic`/`stripHtmlToText`, déplacés depuis `JobDetailsPage.tsx` sans changement de comportement.
- **`src/JobDetailsPage.tsx`** : le rendu de secours (texte brut) passe désormais par ce normaliseur au lieu d'un `pre-wrap` muet. Le HTML natif de la source reste prioritaire et inchangé.
- **`src/JobDetailsPage.css`** : `.jd-desc` n'impose plus `white-space: pre-wrap` au HTML rendu ; ajout d'une typographie dédiée (marges de paragraphe, indentation de listes, hiérarchie de titres, style des liens avec retour à la ligne sur URL longue, tableaux avec défilement horizontal au lieu de débordement, largeur de lecture limitée à 74 caractères).
- **`supabase/functions/ingest_source/sources/france_travail_api.ts`** et **`adzuna_api.ts`** : la fonction de nettoyage de la description ne collapse plus les retours à la ligne réels (seulement les espaces/tabulations répétés). Corrige la cause à la source pour les **prochaines** collectes.

## Migration / backfill

**Aucun.** La reconstruction a lieu à la lecture ; les offres déjà en base bénéficient du correctif dès le déploiement frontend, sans qu'aucune ligne ne soit modifiée en base. Rien à rejouer, rien à borner, rien à journaliser : il n'y a pas d'opération destructive ni irréversible ici, donc pas de plan de rollback de données nécessaire — un rollback consiste simplement à revenir au commit précédent du frontend.

## Ce qui n'est pas (et ne peut pas être) corrigé

- Le texte déjà aplati en base (retours à la ligne perdus avant stockage, pour les offres France Travail/Adzuna déjà ingérées) ne peut pas être restauré à l'identique : l'information de mise en page d'origine n'existe plus nulle part dans la base (le payload brut n'est pas conservé pour ces sources). Le normaliseur compense partiellement via les deux règles ciblées (astérisques, tirets suivis d'une majuscule), mais un texte qui utilisait uniquement des tirets suivis d'une minuscule, ou une ponctuation sans convention reconnaissable, reste un paragraphe simple — fidèle au contenu, mais moins découpé visuellement. Aucune information n'est perdue ni inventée dans ce cas, juste moins mise en forme.
- Le correctif à la source (`france_travail_api.ts`, `adzuna_api.ts`) ne prend effet que pour les **prochaines** collectes, et seulement après un redéploiement manuel de la fonction : `supabase functions deploy ingest_source`. Je ne l'ai pas déclenché moi-même, conformément au fonctionnement du projet où les Edge Functions sont déployées manuellement et vérifiées séparément (CLAUDE.md). Le code déployé actuellement contient donc encore l'ancien comportement d'aplatissement pour ces deux sources tant que ce déploiement n'a pas été fait ; ça n'affecte en rien le correctif de lecture, qui est lui déjà actif.
- Adzuna : l'API elle-même ne fournit qu'un court extrait, pas la description complète. Rien côté JobRadar ne peut faire apparaître un contenu que la source ne donne pas.
- Les autres scrapers (Emploi.ci, Emploi Sénégal, Himalayas, etc.) n'ont pas été retouchés au niveau ingestion : leur volume est faible (quelques centaines d'offres chacun) et le normaliseur frontend couvre déjà leur cas à la lecture. Un retraitement plus poussé de ces sources spécifiques n'apporterait pas de bénéfice proportionné au risque d'y toucher.

## Tests réalisés

- 12 cas synthétiques hors navigateur (esbuild + jsdom) : puces astérisques aplaties (cas réel "Test Lead F/H"), rubrique + tiret aplatis, retours à la ligne réels avec puces et rubriques, liste numérotée, URL nue linkifiée, accents, charge XSS, texte vide, texte très court, contenu ambigu à deux-points non reconnu (ne doit pas devenir un titre), astérisque isolé (ne doit pas devenir une liste), description longue mixte.
- 10 échantillons réels supplémentaires tirés au hasard en base (France Travail, Adzuna, Emploi.ci, MyJobMag), avec mesure du ratio texte-avant/texte-après : aucune perte de contenu détectée (ratio ≥ 0,95 sur tous les cas, l'écart venant uniquement du nettoyage d'espaces, jamais d'un mot supprimé), aucune exception.
- `tsc --noEmit` et `vite build` complets : aucune erreur.
- **Vérification en direct sur `jobradar.go4jobapp.com` après déploiement**, sur le cas exact signalé ("Test Lead F/H", HEXAFRET, source France Travail) : "Présentation du Pôle" apparaît maintenant en titre de rubrique distinct, chaque mission et chaque item de profil apparaît en liste à puces propre, "Profil recherché" et "Expérience requise" sont également bien distingués. Vérifié aussi sur une offre à HTML natif déjà correct (Agence Emploi Jeunes, "IMPRIMEUR") : rendu inchangé et propre, pas de régression.
- Redimensionnement de la fenêtre du navigateur de test à 390×844 tenté pour vérifier le mobile : comme lors d'une vérification précédente sur ce projet, l'outil ne modifie pas réellement le viewport de la page (`window.innerWidth` reste inchangé) — limitation de l'outil, pas du site. En compensation, le CSS a été écrit avec `overflow-wrap`, `word-break` et un défilement horizontal dédié pour les tableaux, ce qui couvre les cas de débordement habituels sur petit écran ; non vérifié visuellement sur un vrai viewport mobile.

## Impact performance

Aucun appel réseau ni IA ajouté. Le normaliseur exécute quelques passes d'expressions régulières sur une chaîne de texte de quelques centaines à quelques milliers de caractères, une seule fois par affichage de page — négligeable comparé au sanitizing DOMPurify déjà en place. Bundle de la page offre inchangé en taille significative (le nouveau module fait ~6 Ko avant minification).

## Nombre d'offres concernées

- 248 886 offres actives (90,7 % du total) bénéficient immédiatement du normaliseur, sans avoir eu de HTML source auparavant.
- 25 462 offres actives (9,3 %) avaient déjà un bon HTML source ; elles bénéficient de la correction CSS.
- 154 988 offres (France Travail) bénéficieront en plus d'une meilleure matière première dès la prochaine collecte, une fois `ingest_source` redéployée.

## Git / déploiement

- Branche `dev`, commit `79d5429` : `fix(jobradar): rend lisibles les descriptions d'offres sans HTML source`.
- Poussé sur `origin/dev` (`ee08455..79d5429`).
- Déploiement automatique confirmé (rendu vérifié en direct ci-dessus).
- **Action manuelle restante** : `supabase functions deploy ingest_source` pour activer la correction d'ingestion sur les prochaines collectes France Travail/Adzuna. Sans cette étape, seul le rendu (déjà actif) profite aux offres existantes ; les nouvelles offres collectées continueront d'arriver aplaties jusqu'au déploiement.

## Plan de rollback

Aucune donnée touchée. Un rollback consiste à revenir au commit précédent (`ee08455`) sur `dev` et à redéployer le frontend ; la fonction `ingest_source` n'a pas été redéployée, donc il n'y a rien à annuler côté Edge Function tant que la commande ci-dessus n'a pas été lancée.
