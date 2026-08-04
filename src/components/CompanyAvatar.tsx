import { useState } from "react";
import { getCompanyAvatar } from "../lib/companyAvatar";
import { getCompanyLogoUrl } from "../lib/companyLogo";

type CompanyAvatarProps = {
  companyName?: string | null;
  applyUrl?: string | null;
  sourceUrl?: string | null;
  // Classe du conteneur (taille/forme) : "jr-avatar" sur le feed, "jd-avatar"
  // sur la page détail. Laissée au caller pour ne pas dupliquer les styles.
  avatarClassName: string;
  imgClassName?: string;
};

// Avatar d'entreprise : tente le logo réel si le domaine de l'offre est dans
// la liste blanche (companyLogo.ts) et qu'une clé logo.dev est configurée ;
// retombe sur l'avatar initiales/globe existant si le logo est absent, hors
// liste, ou échoue à charger (onError). Aucun état intermédiaire "cassé" :
// on ne rend le <img> qu'après avoir une URL candidate, et on bascule vers
// le fallback dès le premier échec.
export function CompanyAvatar({
  companyName,
  applyUrl,
  sourceUrl,
  avatarClassName,
  imgClassName,
}: CompanyAvatarProps) {
  const logoUrl = getCompanyLogoUrl(applyUrl, sourceUrl);
  const [imgFailed, setImgFailed] = useState(false);
  const avatar = getCompanyAvatar(companyName);

  if (logoUrl && !imgFailed) {
    return (
      <span className={avatarClassName} aria-hidden="true">
        <img
          className={imgClassName}
          src={logoUrl}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className={avatarClassName} style={{ background: avatar.bg, color: avatar.fg }} aria-hidden="true">
      {avatar.initials}
    </span>
  );
}
