# SONDAGE NORD-OUEST — démarrage local

1. Ouvrir le dossier dans VS Code.
2. Extension **Live Server** → clic droit sur `index.html` → *Open with Live Server*.
   (Fonctionne aussi en double-cliquant `index.html` : aucun module, aucun build.)
3. Administration : lien « Administration » en pied de page (`#/admin`). Au premier accès, vous choisissez votre mot de passe.

Données dans le `localStorage` du navigateur (mode démo local). Aucun candidat ni résultat fictif : ajoutez-les via l'administration.

## Limites
- Mode local : aucune vraie sécurité (tout est dans le navigateur) ; 1 participation par navigateur et par sondage.
- Production : exécuter `supabase/schema.sql`, puis brancher le frontend (non fait).
- Vérifier les rattachements communes/arrondissements ; sections communales non incluses.
