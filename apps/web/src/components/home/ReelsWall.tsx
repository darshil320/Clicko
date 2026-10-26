import { CREATOR_POINTS } from '../../content/moments';
import { REEL_WALL, REELS } from '../../content/reels';
import { ButtonArrow } from '../ui/ButtonArrow';
import { ReelVideo } from '../ui/ReelVideo';
import { Section } from '../ui/Section';

/** A swipeable row of vertical sample reels, then what a creator gets (ADR-0023). */
export function ReelsWall() {
  return (
    <Section
      id="reels"
      eyebrow="Photos + video"
      title={
        <>
          Clips for your feed, <em>straight off the shoot.</em>
        </>
      }
      lead="Licensed sample reels, to show the look. Book photos and video together and every clip comes back unedited and camera-original, ready for your own edit."
    >
      <ul className="reel-wall" aria-label="Sample reels">
        {REEL_WALL.map((item) => {
          const reel = REELS[item.reel];
          return reel ? (
            <li key={item.reel}>
              <ReelVideo reel={reel} caption={item.label} />
            </li>
          ) : null;
        })}
      </ul>
      <div className="creators reveal">
        <div className="creators-head">
          <p className="eyebrow">For creators</p>
          <h3>
            Stills for the grid. <em>Clips for the reels.</em>
          </h3>
          <a className="btn btn-dark" href="#shoot-creator">
            Plan a content day
            <ButtonArrow />
          </a>
        </div>
        <ul className="checklist">
          {CREATOR_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
